import { assert, it } from "@effect/vitest";
import {
  LEARNING_MAX_PRACTICE_TERMINALS,
  LEARNING_TERMINAL_SCROLLBACK_CHARS,
  LearningError,
  ThreadId,
  type LearningTerminalEvent,
} from "@aprende/contracts";
import * as HostProcess from "@aprende/shared/HostProcess";
import * as PtyAdapter from "@aprende/shared/PtyAdapter";
import type * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as LearningService from "./LearningService.ts";
import * as PracticeTerminalService from "./PracticeTerminalService.ts";

const threadId = ThreadId.make("thread-terminal");
const otherThreadId = ThreadId.make("thread-terminal-other");
const size = { cols: 80, rows: 24 };
const target = (problemId: string, thread = threadId) => ({ threadId: thread, problemId });

class FakePty implements PtyAdapter.PtyProcess {
  readonly pid = 1;
  readonly writes: Array<string> = [];
  readonly sizes: Array<readonly [number, number]> = [];
  readonly signals: Array<string | undefined> = [];
  readonly killed = Deferred.makeUnsafe<void>();
  readonly sigkilled = Deferred.makeUnsafe<void>();
  private dataListeners = new Set<(data: string) => void>();
  private exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  readonly input: PtyAdapter.PtySpawnInput;
  /** Like a shell that ran `trap '' HUP`: only SIGKILL ends it. */
  private readonly trapsHangup: boolean;
  constructor(input: PtyAdapter.PtySpawnInput, trapsHangup: boolean) {
    this.input = input;
    this.trapsHangup = trapsHangup;
  }
  write(data: string) {
    this.writes.push(data);
  }
  resize(cols: number, rows: number) {
    this.sizes.push([cols, rows]);
  }
  kill(signal?: string) {
    this.signals.push(signal);
    Deferred.doneUnsafe(this.killed, Exit.void);
    if (signal === "SIGKILL") Deferred.doneUnsafe(this.sigkilled, Exit.void);
    if (signal === "SIGKILL" || !this.trapsHangup) this.exit(128 + (signal === "SIGKILL" ? 9 : 1));
  }
  onData(callback: (data: string) => void) {
    this.dataListeners.add(callback);
    return () => void this.dataListeners.delete(callback);
  }
  onExit(callback: (event: PtyAdapter.PtyExitEvent) => void) {
    this.exitListeners.add(callback);
    return () => void this.exitListeners.delete(callback);
  }
  emit(data: string) {
    for (const listener of this.dataListeners) listener(data);
  }
  exit(exitCode: number) {
    for (const listener of this.exitListeners) listener({ exitCode, signal: null });
  }
}

const isKilled = (pty: FakePty) => Deferred.isDone(pty.killed);

/** Practice folders by problem id; a problem missing here has none. */
const folders: Record<string, string> = {
  "prob-a": "/session/practice/a",
  "prob-b": "/session/practice/b",
  "prob-c": "/session/practice/c",
  "prob-d": "/session/practice/d",
  "prob-e": "/session/practice/e",
};

const makeHarness = Effect.fn(function* (
  options: {
    readonly trapsHangup?: boolean;
    /** Holds every practice folder lookup until released. */
    readonly folderLookup?: {
      readonly started: Deferred.Deferred<void>;
      readonly release: Deferred.Deferred<void>;
    };
  } = {},
) {
  const spawned: Array<FakePty> = [];
  const threadEvents = yield* Queue.unbounded<{ type: string; threadId: ThreadId }>();
  // Offered each time the service waits for the next thread event, so after it handled the last.
  const waitingForEvent = yield* Queue.unbounded<void>();
  /** Delivers a thread event and returns once the service has handled it. */
  const deliver = (event: { type: string; threadId: ThreadId }) =>
    Queue.take(waitingForEvent).pipe(
      Effect.andThen(Queue.offer(threadEvents, event)),
      Effect.andThen(Queue.take(waitingForEvent)),
    );
  const hold = options.folderLookup;
  const layer = PracticeTerminalService.layer.pipe(
    Layer.provide(
      Layer.mock(LearningService.LearningService)({
        practiceFolder: (input) =>
          Effect.gen(function* () {
            if (hold !== undefined) {
              yield* Deferred.succeed(hold.started, undefined);
              yield* Deferred.await(hold.release);
            }
            const folder = folders[input.problemId];
            if (folder === undefined)
              return yield* new LearningError({ message: "This problem has no practice folder." });
            return folder;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        streamDomainEvents: Stream.fromEffectRepeat(
          Queue.offer(waitingForEvent, undefined).pipe(Effect.andThen(Queue.take(threadEvents))),
        ) as never,
      }),
    ),
    Layer.provide(
      Layer.succeed(PtyAdapter.PtyAdapter)({
        spawn: (input) =>
          Effect.sync(() => {
            const pty = new FakePty(input, options.trapsHangup ?? false);
            spawned.push(pty);
            return pty;
          }),
      }),
    ),
    Layer.provide(
      Layer.succeed(HostProcess.Environment)({
        SHELL: "/bin/test-shell",
        HOME: "/home/learner",
        APRENDE_HOME: "/home/learner/.aprende",
      }),
    ),
  );
  return { spawned, deliver, layer };
});
type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const nextEvent = (events: Queue.Dequeue<LearningTerminalEvent, Cause.Done>) => Queue.take(events);

it.effect("opens one shell per problem in its practice folder and forwards input", () =>
  Effect.gen(function* () {
    const { spawned, layer } = yield* makeHarness();
    yield* Effect.gen(function* () {
      const terminals = yield* PracticeTerminalService.PracticeTerminalService;
      yield* terminals.open({ ...target("prob-a"), ...size });
      assert.equal(spawned.length, 1);
      const pty = spawned[0]!;
      assert.equal(pty.input.cwd, "/session/practice/a");
      assert.equal(pty.input.shell, "/bin/test-shell");
      assert.equal(pty.input.env["HOME"], "/home/learner");
      assert.isUndefined(pty.input.env["APRENDE_HOME"]);

      yield* terminals.write({ ...target("prob-a"), data: "python3 main.py\r" });
      yield* terminals.resize({ ...target("prob-a"), cols: 120, rows: 40 });
      // Opening it again, as reopening the panel does, keeps the running shell.
      yield* terminals.open({ ...target("prob-a"), cols: 100, rows: 30 });
      assert.equal(spawned.length, 1);
      assert.deepEqual(pty.writes, ["python3 main.py\r"]);
      assert.deepEqual(pty.sizes, [
        [120, 40],
        [100, 30],
      ]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("refuses a problem without a practice folder", () =>
  Effect.gen(function* () {
    const { spawned, layer } = yield* makeHarness();
    yield* Effect.gen(function* () {
      const terminals = yield* PracticeTerminalService.PracticeTerminalService;
      const error = yield* Effect.flip(terminals.open({ ...target("prob-none"), ...size }));
      assert.equal(error.message, "This problem has no practice folder.");
      assert.equal(spawned.length, 0);
      const write = yield* Effect.flip(terminals.write({ ...target("prob-none"), data: "ls\r" }));
      assert.include(write.message, "This terminal is closed.");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("replays bounded scrollback to a new subscriber, then streams live output", () =>
  Effect.gen(function* () {
    const { spawned, layer } = yield* makeHarness();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const terminals = yield* PracticeTerminalService.PracticeTerminalService;
        yield* terminals.open({ ...target("prob-a"), ...size });
        const pty = spawned[0]!;
        pty.emit("x".repeat(LEARNING_TERMINAL_SCROLLBACK_CHARS));
        pty.emit("$ ");

        const events = yield* Stream.toQueue(terminals.subscribe(target("prob-a")), {
          capacity: "unbounded",
        });
        const snapshot = yield* nextEvent(events);
        assert.equal(snapshot.type, "snapshot");
        if (snapshot.type !== "snapshot") return;
        assert.equal(snapshot.data.length, LEARNING_TERMINAL_SCROLLBACK_CHARS);
        assert.isTrue(snapshot.data.endsWith("x$ "));

        pty.emit("hello\r\n");
        assert.deepEqual(yield* nextEvent(events), { type: "output", data: "hello\r\n" });
        pty.exit(3);
        assert.deepEqual(yield* nextEvent(events), { type: "ended", exitCode: 3 });

        // An exited shell frees its slot; opening again starts a new one.
        yield* terminals.open({ ...target("prob-a"), ...size });
        assert.equal(spawned.length, 2);
      }),
    ).pipe(Effect.provide(layer));
  }),
);

it.effect("caps live terminals and frees a slot when one closes", () =>
  Effect.gen(function* () {
    const { spawned, layer } = yield* makeHarness();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const terminals = yield* PracticeTerminalService.PracticeTerminalService;
        const problems = ["prob-a", "prob-b", "prob-c", "prob-d"];
        assert.equal(problems.length, LEARNING_MAX_PRACTICE_TERMINALS);
        for (const problemId of problems) yield* terminals.open({ ...target(problemId), ...size });

        const refused = yield* Effect.flip(terminals.open({ ...target("prob-e"), ...size }));
        assert.include(refused.message, `${LEARNING_MAX_PRACTICE_TERMINALS} practice terminals`);
        assert.equal(spawned.length, LEARNING_MAX_PRACTICE_TERMINALS);

        const events = yield* Stream.toQueue(terminals.subscribe(target("prob-a")), {
          capacity: "unbounded",
        });
        assert.equal((yield* nextEvent(events)).type, "snapshot");
        yield* terminals.close(target("prob-a"));
        assert.isTrue(yield* isKilled(spawned[0]!));
        assert.deepEqual(yield* nextEvent(events), { type: "ended", exitCode: null });
        const write = yield* Effect.flip(terminals.write({ ...target("prob-a"), data: "ls\r" }));
        assert.include(write.message, "This terminal is closed.");

        yield* terminals.open({ ...target("prob-e"), ...size });
        assert.equal(spawned.at(-1)!.input.cwd, "/session/practice/e");
      }),
    ).pipe(Effect.provide(layer));
  }),
);

it.effect("kills a thread's shells when it is archived, and every shell on shutdown", () =>
  Effect.gen(function* () {
    const { spawned, deliver, layer } = yield* makeHarness();
    yield* Effect.gen(function* () {
      const terminals = yield* PracticeTerminalService.PracticeTerminalService;
      yield* terminals.open({ ...target("prob-a"), ...size });
      yield* terminals.open({ ...target("prob-b", otherThreadId), ...size });
      yield* deliver({ type: "thread.archived", threadId });
      assert.isTrue(yield* isKilled(spawned[0]!));
      assert.isFalse(yield* isKilled(spawned[1]!));
    }).pipe(Effect.provide(layer));
    assert.isTrue(yield* isKilled(spawned[1]!));
  }),
);

it.effect("kills a shell whose open was still starting when its problem or thread closed", () =>
  Effect.gen(function* () {
    const closers = {
      close: (_: Harness, terminals: PracticeTerminalService.PracticeTerminalService["Service"]) =>
        terminals.close(target("prob-a")),
      archive: (harness: Harness) => harness.deliver({ type: "thread.archived", threadId }),
    };
    for (const [name, closeIt] of Object.entries(closers)) {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const harness = yield* makeHarness({ folderLookup: { started, release } });
      yield* Effect.gen(function* () {
        const terminals = yield* PracticeTerminalService.PracticeTerminalService;
        const opening = yield* Effect.forkChild(terminals.open({ ...target("prob-a"), ...size }));
        yield* Deferred.await(started);
        yield* closeIt(harness, terminals);
        yield* Deferred.succeed(release, undefined);
        const opened = yield* Fiber.await(opening);
        assert.isTrue(yield* isKilled(harness.spawned[0]!), name);
        assert.isTrue(Exit.isFailure(opened), name);
        const write = yield* Effect.flip(terminals.write({ ...target("prob-a"), data: "ls\r" }));
        assert.include(write.message, "This terminal is closed.", name);
      }).pipe(Effect.provide(harness.layer));
    }
  }),
);

it.effect("keeps a closed shell that ignores SIGHUP counted until SIGKILL ends it", () =>
  Effect.gen(function* () {
    const { spawned, layer } = yield* makeHarness({ trapsHangup: true });
    const scope = yield* Scope.make();
    const services = yield* Layer.buildWithScope(layer, scope);
    yield* Effect.gen(function* () {
      const terminals = yield* PracticeTerminalService.PracticeTerminalService;
      for (const problemId of ["prob-a", "prob-b", "prob-c", "prob-d"])
        yield* terminals.open({ ...target(problemId), ...size });
      yield* terminals.close(target("prob-a"));
      const shell = spawned[0]!;
      assert.deepEqual(shell.signals, ["SIGHUP"]);
      const write = yield* Effect.flip(terminals.write({ ...target("prob-a"), data: "ls\r" }));
      assert.include(write.message, "This terminal is closed.");
      // Still running, so it still takes a slot.
      const refused = yield* Effect.flip(terminals.open({ ...target("prob-e"), ...size }));
      assert.include(refused.message, `${LEARNING_MAX_PRACTICE_TERMINALS} practice terminals`);

      yield* TestClock.adjust(PracticeTerminalService.CLOSE_GRACE);
      yield* Deferred.await(shell.sigkilled);
      assert.deepEqual(shell.signals, ["SIGHUP", "SIGKILL"]);
      yield* terminals.open({ ...target("prob-e"), ...size });
      assert.equal(spawned.at(-1)!.input.cwd, "/session/practice/e");
    }).pipe(Effect.provide(services));

    // Shutting down gives every shell the same grace, then kills the ones still running.
    const shutdown = yield* Effect.forkChild(Scope.close(scope, Exit.void));
    const live = spawned.slice(1);
    for (const pty of live) yield* Deferred.await(pty.killed);
    yield* TestClock.adjust(PracticeTerminalService.CLOSE_GRACE);
    yield* Fiber.join(shutdown);
    for (const pty of live) assert.deepEqual(pty.signals, ["SIGHUP", "SIGKILL"]);
  }),
);
