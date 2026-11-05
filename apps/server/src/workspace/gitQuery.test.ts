import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { runGitQuery } from "./gitQuery.ts";

it.effect("keeps git from opening a folder laid out as a bare repository", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-git-query-bare-" });
    yield* fileSystem.makeDirectory(path.join(cwd, "objects", "info"), { recursive: true });
    yield* fileSystem.makeDirectory(path.join(cwd, "refs", "heads"), { recursive: true });
    yield* fileSystem.writeFileString(path.join(cwd, "HEAD"), "ref: refs/heads/main\n");
    yield* fileSystem.writeFileString(
      path.join(cwd, "config"),
      '[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n\tfsmonitor = "echo ran >> fsmonitor-runs; false"\n',
    );

    const result = yield* runGitQuery({
      args: ["status"],
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });

    expect(result?.exitCode).not.toBe(0);
    expect(yield* fileSystem.exists(path.join(cwd, "fsmonitor-runs"))).toBe(false);
  }).pipe(
    Effect.scoped,
    Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  ),
);
