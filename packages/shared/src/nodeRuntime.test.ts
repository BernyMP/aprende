import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import * as HostProcess from "./HostProcess.ts";
import { resolveSelfInvocation, selfInvocationArgs } from "./nodeRuntime.ts";

describe("Self invocation", () => {
  it.effect("runs the entrypoint script with the current runtime", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const invocation = yield* resolveSelfInvocation().pipe(
        Effect.provideService(HostProcess.ExecutablePath, "/runtime/node"),
        Effect.provideService(HostProcess.IsExecutable, false),
        Effect.provideService(HostProcess.Arguments, ["/runtime/node", "dist/bin.mjs", "serve"]),
      );
      expect(invocation.command).toBe("/runtime/node");
      expect(invocation.entrypoint).toBe(path.resolve("dist/bin.mjs"));
      expect(selfInvocationArgs(invocation, ["acp-mcp-bridge"])).toEqual([
        path.resolve("dist/bin.mjs"),
        "acp-mcp-bridge",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("passes subcommands straight to the standalone executable", () =>
    Effect.gen(function* () {
      // Node repeats the binary at argv[1] for a single-executable; it is not a script.
      const invocation = yield* resolveSelfInvocation().pipe(
        Effect.provideService(HostProcess.ExecutablePath, "/packaged/t3"),
        Effect.provideService(HostProcess.IsExecutable, true),
        Effect.provideService(HostProcess.Arguments, ["/packaged/t3", "/packaged/t3", "serve"]),
      );
      expect(invocation).toEqual({ command: "/packaged/t3", entrypoint: undefined });
      expect(selfInvocationArgs(invocation, ["acp-mcp-bridge"])).toEqual(["acp-mcp-bridge"]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
