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
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

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
  readonly killed = Deferred.makeUnsafe<void>();
  private dataListeners = new Set<(data: string) => void>();
  private exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  readonly input: PtyAdapter.PtySpawnInput;
  constructor(input: PtyAdapter.PtySpawnInput) {
    this.input = input;
  }
  write(data: string) {
    this.writes.push(data);
  }
  resize(cols: number, rows: number) {
    this.sizes.push([cols, rows]);
  }
  kill() {
    Deferred.doneUnsafe(this.killed, Exit.void);
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

const makeHarness = Effect.gen(function* () {
  const spawned: Array<FakePty> = [];
  const threadEvents = yield* Queue.unbounded<{ type: string; threadId: ThreadId }>();
  const layer = PracticeTerminalService.layer.pipe(
    Layer.provide(
      Layer.mock(LearningService.LearningService)({
        practiceFolder: (input) =>
          folders[input.problemId] === undefined
            ? Effect.fail(new LearningError({ message: "This problem has no practice folder." }))
            : Effect.succeed(folders[input.problemId]!),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        streamDomainEvents: Stream.fromQueue(threadEvents) as never,
      }),
    ),
    Layer.provide(
      Layer.succeed(PtyAdapter.PtyAdapter)({
        spawn: (input) =>
          Effect.sync(() => {
            const pty = new FakePty(input);
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
  return { spawned, threadEvents, layer };
});

const nextEvent = (events: Queue.Dequeue<LearningTerminalEvent, Cause.Done>) => Queue.take(events);

it.effect("opens one shell per problem in its practice folder and forwards input", () =>
  Effect.gen(function* () {
    const { spawned, layer } = yield* makeHarness;
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
    const { spawned, layer } = yield* makeHarness;
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
    const { spawned, layer } = yield* makeHarness;
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
    const { spawned, layer } = yield* makeHarness;
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
    const { spawned, threadEvents, layer } = yield* makeHarness;
    yield* Effect.gen(function* () {
      const terminals = yield* PracticeTerminalService.PracticeTerminalService;
      yield* terminals.open({ ...target("prob-a"), ...size });
      yield* terminals.open({ ...target("prob-b", otherThreadId), ...size });
      yield* Queue.offer(threadEvents, { type: "thread.archived", threadId });
      yield* Deferred.await(spawned[0]!.killed);
      assert.isFalse(yield* isKilled(spawned[1]!));
    }).pipe(Effect.provide(layer));
    assert.isTrue(yield* isKilled(spawned[1]!));
  }),
);
