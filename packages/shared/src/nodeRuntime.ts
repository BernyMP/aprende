import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import * as HostProcess from "./HostProcess.ts";

export interface SelfInvocation {
  readonly command: string;
  /** Absolute script entrypoint; undefined for packaged binaries, which dispatch subcommands from argv[2]. */
  readonly entrypoint: string | undefined;
}

/** Packaged binaries repeat the binary at argv[1]; callers must not assemble execPath/argv[1] themselves. */
export const resolveSelfInvocation = Effect.fn("nodeRuntime.resolveSelfInvocation")(function* () {
  const command = yield* HostProcess.ExecutablePath;
  if (yield* HostProcess.IsExecutable)
    return { command, entrypoint: undefined } satisfies SelfInvocation;
  const path = yield* Path.Path;
  const entry = (yield* HostProcess.Arguments)[1];
  // Children spawn from their own working directory, so the script path must be absolute.
  return {
    command,
    entrypoint: entry === undefined ? undefined : path.resolve(entry),
  } satisfies SelfInvocation;
});

export const selfInvocationArgs = (
  invocation: SelfInvocation,
  args: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  invocation.entrypoint === undefined ? args : [invocation.entrypoint, ...args];
