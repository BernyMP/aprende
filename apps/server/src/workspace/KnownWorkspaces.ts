import * as NodeSqliteClient from "@aprende/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

export class UnknownWorkspaceError extends Schema.TaggedError<UnknownWorkspaceError>()(
  "UnknownWorkspaceError",
  {
    cwd: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `'${this.cwd}' is not inside a registered project or a thread's workspace.`;
  }
}

/** Resolve candidate and root consistently before checking containment. */
export const isWithinRoot = (path: Path.Path, candidate: string, root: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

export class KnownWorkspaces extends Context.Service<
  KnownWorkspaces,
  {
    /** Takes a symlink-resolved path. */
    readonly contains: (realPath: string) => Effect.Effect<boolean>;
    /** Fails unless `cwd` exists and resolves inside a known workspace. */
    readonly assertContains: (cwd: string) => Effect.Effect<void, UnknownWorkspaceError>;
  }
>()("aprende/workspace/KnownWorkspaces") {}

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const sql = yield* SqlClient.SqlClient;

  // Missing roots keep lexical paths; other resolution failures and filesystem roots grant nothing.
  const resolveRoot = (value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          Effect.succeed(cause.reason._tag === "NotFound" ? resolvedPath : null),
      }),
      Effect.map((root) => (root === null || path.dirname(root) === root ? null : root)),
    );
  };

  const contains: KnownWorkspaces["Service"]["contains"] = Effect.fn("KnownWorkspaces.contains")(
    function* (realPath) {
      const within = (root: string | null) => root !== null && isWithinRoot(path, realPath, root);
      const projects = yield* projectStore.listShells().pipe(Effect.orElseSucceed(() => []));
      for (const project of projects) {
        if (within(yield* resolveRoot(project.workspaceRoot))) return true;
      }
      // Threads from older releases may still run in a worktree outside their project.
      const threads = yield* sql<{ readonly worktreePath: string }>`
        SELECT DISTINCT json_extract(payload_json, '$.worktreePath') AS "worktreePath"
        FROM orchestration_v2_projection_threads
        WHERE deleted_at IS NULL AND json_extract(payload_json, '$.worktreePath') IS NOT NULL
      `.pipe(
        NodeSqliteClient.readOnly,
        Effect.orElseSucceed(() => []),
      );
      for (const { worktreePath } of threads) {
        // A relative path would resolve against the server's cwd.
        if (path.isAbsolute(worktreePath) && within(yield* resolveRoot(worktreePath))) return true;
      }
      return false;
    },
  );

  const assertContains: KnownWorkspaces["Service"]["assertContains"] = Effect.fn(
    "KnownWorkspaces.assertContains",
  )(function* (cwd) {
    // `..` collapses on the path as named before symlinks resolve, as the write does.
    const realCwd = yield* fileSystem
      .realPath(path.resolve(cwd))
      .pipe(Effect.mapError((cause) => new UnknownWorkspaceError({ cwd, cause })));
    if (!(yield* contains(realCwd))) return yield* new UnknownWorkspaceError({ cwd });
  });

  return KnownWorkspaces.of({ contains, assertContains });
});

export const layer = Layer.effect(KnownWorkspaces, make);
