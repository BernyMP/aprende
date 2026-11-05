import {
  LEARNING_MAX_PRACTICE_TERMINALS,
  LEARNING_TERMINAL_SCROLLBACK_CHARS,
  LearningError,
  type LearningTerminalEvent,
  type LearningTerminalOpenInput,
  type LearningTerminalResizeInput,
  type LearningTerminalTarget,
  type LearningTerminalWriteInput,
  type ThreadId,
} from "@aprende/contracts";
import * as HostProcess from "@aprende/shared/HostProcess";
import * as PtyAdapter from "@aprende/shared/PtyAdapter";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as LearningService from "./LearningService.ts";

export class PracticeTerminalService extends Context.Service<
  PracticeTerminalService,
  {
    /** Starts a shell in the problem's practice folder, or resizes the one already running. */
    readonly open: (input: LearningTerminalOpenInput) => Effect.Effect<void, LearningError>;
    readonly write: (input: LearningTerminalWriteInput) => Effect.Effect<void, LearningError>;
    readonly resize: (input: LearningTerminalResizeInput) => Effect.Effect<void, LearningError>;
    /** Kills the shell. Closing one that is not running does nothing. */
    readonly close: (input: LearningTerminalTarget) => Effect.Effect<void>;
    /** Recent output first, then live output, then how the shell ended. */
    readonly subscribe: (input: LearningTerminalTarget) => Stream.Stream<LearningTerminalEvent>;
  }
>()("aprende/learning/PracticeTerminalService") {}

interface Terminal {
  readonly key: string;
  readonly threadId: ThreadId;
  readonly process: PtyAdapter.PtyProcess;
  /** The last output, up to the scrollback cap; it ends at `written`. */
  scrollback: string;
  /** Characters of output since the shell started. */
  written: number;
  /** Set once the shell exits or is closed. */
  exitCode: number | null | undefined;
  readonly listeners: Set<() => void>;
  stopOutput: () => void;
  /** Sends SIGKILL to a closed shell that is still running after the grace period. */
  reaper: Fiber.Fiber<void> | undefined;
}

/** An open waiting for its folder or shell; closing its problem or thread cancels it. */
interface PendingOpen {
  readonly key: string;
  readonly threadId: ThreadId;
  cancelled: boolean;
}

/** How long a closed shell has to exit after SIGHUP before it gets SIGKILL. */
export const CLOSE_GRACE = Duration.seconds(2);

const fail = (message: string, cause?: unknown) =>
  new LearningError(cause === undefined ? { message } : { message, cause });

const CLOSED = "This terminal is closed. Open it again to start a new shell.";

const keyOf = (target: LearningTerminalTarget) => `${target.threadId}\u0000${target.problemId}`;

// The server's own variables would point programs in the shell at the server.
const isServerVariable = (key: string) => {
  const upper = key.toUpperCase();
  return (
    upper.startsWith("APRENDE_") ||
    upper.startsWith("VITE_") ||
    upper === "PORT" ||
    upper === "ELECTRON_RUN_AS_NODE" ||
    upper === "ELECTRON_RENDERER_PORT"
  );
};

const shellCandidates = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) =>
  [
    ...new Set(
      platform === "win32"
        ? ["pwsh.exe", "powershell.exe", env["ComSpec"] ?? "cmd.exe"]
        : [env["SHELL"]?.trim() || "/bin/zsh", "/bin/zsh", "/bin/bash", "/bin/sh"],
    ),
  ] as const;

const make = Effect.gen(function* () {
  const pty = yield* PtyAdapter.PtyAdapter;
  const learning = yield* LearningService.LearningService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const platform = yield* HostProcess.Platform;
  const hostEnv = yield* HostProcess.Environment;
  // Open shells by problem.
  const terminals = new Map<string, Terminal>();
  // Every shell until its exit is seen, closed ones included. These count toward the cap.
  const running = new Set<Terminal>();
  const pendingOpens = new Set<PendingOpen>();
  // Opening checks the cap and spawns as one step, so two opens cannot both take the last slot.
  const opening = Semaphore.makeUnsafe(1);

  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(hostEnv).filter(([key]) => !isServerVariable(key))),
    COLORTERM: "truecolor",
  };

  const end = (terminal: Terminal, exitCode: number | null) => {
    if (terminal.exitCode !== undefined) return;
    terminal.exitCode = exitCode;
    if (terminals.get(terminal.key) === terminal) terminals.delete(terminal.key);
    terminal.stopOutput();
    for (const listener of terminal.listeners) listener();
  };

  const exited = (terminal: Terminal, exitCode: number) => {
    running.delete(terminal);
    terminal.reaper?.interruptUnsafe();
    end(terminal, exitCode);
  };

  const signal = (terminal: Terminal, name?: string) => {
    try {
      terminal.process.kill(name);
    } catch {
      // Already gone.
    }
  };

  // A shell may ignore SIGHUP (`trap '' HUP`), so it stays tracked until its exit is seen.
  const closeTerminal = Effect.fn("PracticeTerminalService.closeTerminal")(function* (
    terminal: Terminal,
  ) {
    if (terminal.exitCode !== undefined) return;
    end(terminal, null);
    // node-pty ends the whole process tree on Windows, which has no signals.
    if (platform === "win32") {
      running.delete(terminal);
      signal(terminal);
      return;
    }
    // Started before the signal, so a shell that exits on SIGHUP at once interrupts it.
    terminal.reaper = yield* Effect.sleep(CLOSE_GRACE).pipe(
      Effect.andThen(Effect.sync(() => signal(terminal, "SIGKILL"))),
      Effect.forkDetach({ startImmediately: true, uninterruptible: false }),
    );
    signal(terminal, "SIGHUP");
  });

  const register = (key: string, threadId: ThreadId, shell: PtyAdapter.PtyProcess) => {
    const terminal: Terminal = {
      key,
      threadId,
      process: shell,
      scrollback: "",
      written: 0,
      exitCode: undefined,
      listeners: new Set(),
      stopOutput: () => {},
      reaper: undefined,
    };
    terminals.set(key, terminal);
    running.add(terminal);
    terminal.stopOutput = shell.onData((data) => {
      terminal.scrollback = (terminal.scrollback + data).slice(-LEARNING_TERMINAL_SCROLLBACK_CHARS);
      terminal.written += data.length;
      for (const listener of terminal.listeners) listener();
    });
    shell.onExit((event) => exited(terminal, event.exitCode));
    return terminal;
  };

  const resizeProcess = (
    terminal: Terminal,
    size: { readonly cols: number; readonly rows: number },
  ) => {
    try {
      terminal.process.resize(size.cols, size.rows);
    } catch {
      // A shell that is exiting cannot be resized; its exit ends the terminal.
    }
  };

  const spawnShell = Effect.fn("PracticeTerminalService.spawnShell")(function* (
    cwd: string,
    size: { readonly cols: number; readonly rows: number },
  ) {
    const shells = shellCandidates(platform, env);
    let lastError: PtyAdapter.PtySpawnError | undefined;
    for (const shell of shells) {
      const spawned = yield* pty
        .spawn({ shell, cwd, cols: size.cols, rows: size.rows, env })
        .pipe(Effect.result);
      if (spawned._tag === "Success") return spawned.success;
      lastError = spawned.failure;
    }
    return yield* fail("Could not start a shell in the practice folder.", lastError);
  });

  const open: PracticeTerminalService["Service"]["open"] = Effect.fn(
    "PracticeTerminalService.open",
  )(function* (input) {
    const key = keyOf(input);
    const pending: PendingOpen = { key, threadId: input.threadId, cancelled: false };
    pendingOpens.add(pending);
    yield* Semaphore.withPermit(
      opening,
      // A shell spawned here is registered even if the request is interrupted, so it can be killed.
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (pending.cancelled) return yield* fail(CLOSED);
          const existing = terminals.get(key);
          if (existing !== undefined) {
            resizeProcess(existing, input);
            return;
          }
          if (running.size >= LEARNING_MAX_PRACTICE_TERMINALS)
            return yield* fail(
              `You have ${LEARNING_MAX_PRACTICE_TERMINALS} practice terminals open, the most at once. Close one to open another.`,
            );
          const cwd = yield* restore(learning.practiceFolder(input));
          const shell = yield* restore(spawnShell(cwd, input));
          const terminal = register(key, input.threadId, shell);
          if (pending.cancelled) {
            yield* closeTerminal(terminal);
            return yield* fail(CLOSED);
          }
        }),
      ),
    ).pipe(Effect.ensuring(Effect.sync(() => pendingOpens.delete(pending))));
  });

  const runningTerminal = (input: LearningTerminalTarget) => {
    const terminal = terminals.get(keyOf(input));
    return terminal === undefined ? Effect.fail(fail(CLOSED)) : Effect.succeed(terminal);
  };

  const write: PracticeTerminalService["Service"]["write"] = Effect.fn(
    "PracticeTerminalService.write",
  )(function* (input) {
    const terminal = yield* runningTerminal(input);
    yield* Effect.try({
      try: () => terminal.process.write(input.data),
      catch: (cause) => fail(CLOSED, cause),
    });
  });

  const resize: PracticeTerminalService["Service"]["resize"] = Effect.fn(
    "PracticeTerminalService.resize",
  )(function* (input) {
    resizeProcess(yield* runningTerminal(input), input);
  });

  const close: PracticeTerminalService["Service"]["close"] = Effect.fn(
    "PracticeTerminalService.close",
  )(function* (input) {
    const key = keyOf(input);
    for (const pending of pendingOpens) if (pending.key === key) pending.cancelled = true;
    const terminal = terminals.get(key);
    if (terminal !== undefined) yield* closeTerminal(terminal);
  });

  // Each subscriber sends what was written since its last event. One that falls further behind
  // than the scrollback gets a fresh snapshot, so a flood of output never queues up in memory.
  const subscribe: PracticeTerminalService["Service"]["subscribe"] = (input) =>
    Stream.callback<LearningTerminalEvent>(
      (queue) =>
        Effect.gen(function* () {
          const terminal = terminals.get(keyOf(input));
          if (terminal === undefined) {
            Queue.offerUnsafe(queue, { type: "ended", exitCode: null });
            Queue.endUnsafe(queue);
            return;
          }
          const wake = yield* Queue.sliding<void>(1);
          const listener = () => Queue.offerUnsafe(wake, undefined);
          // Read the snapshot and listen in one synchronous step, so no output falls between them.
          let sent = terminal.written;
          Queue.offerUnsafe(queue, { type: "snapshot", data: terminal.scrollback });
          terminal.listeners.add(listener);
          yield* Effect.addFinalizer(() => Effect.sync(() => terminal.listeners.delete(listener)));
          if (terminal.exitCode !== undefined) listener();
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              while (true) {
                yield* Queue.take(wake);
                const unsent = terminal.written - sent;
                sent = terminal.written;
                if (unsent > terminal.scrollback.length)
                  yield* Queue.offer(queue, { type: "snapshot", data: terminal.scrollback });
                else if (unsent > 0)
                  yield* Queue.offer(queue, {
                    type: "output",
                    data: terminal.scrollback.slice(-unsent),
                  });
                if (terminal.exitCode !== undefined) {
                  yield* Queue.offer(queue, { type: "ended", exitCode: terminal.exitCode });
                  yield* Queue.end(queue);
                  return;
                }
              }
            }),
          );
        }),
      { bufferSize: 1, strategy: "suspend" },
    );

  const closeThread = Effect.fn("PracticeTerminalService.closeThread")(function* (
    threadId: ThreadId,
  ) {
    for (const pending of pendingOpens) if (pending.threadId === threadId) pending.cancelled = true;
    for (const terminal of terminals.values())
      if (terminal.threadId === threadId) yield* closeTerminal(terminal);
  });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      for (const pending of pendingOpens) pending.cancelled = true;
      for (const terminal of terminals.values()) yield* closeTerminal(terminal);
      yield* Fiber.awaitAll([...running].flatMap((terminal) => terminal.reaper ?? []));
    }),
  );
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      event.type === "thread.archived" || event.type === "thread.deleted"
        ? closeThread(event.threadId)
        : Effect.void,
    ).pipe(
      Effect.ignore({
        log: true,
        message: "Practice terminals stopped following thread archives.",
      }),
    ),
  );

  return PracticeTerminalService.of({ open, write, resize, close, subscribe });
});

export const layer = Layer.effect(PracticeTerminalService, make);
