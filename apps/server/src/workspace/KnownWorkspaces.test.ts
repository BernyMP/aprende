import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";

const makeLayer = (projectRoot: string) =>
  KnownWorkspaces.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        listShells: () => Effect.succeed([{ id: "project", workspaceRoot: projectRoot }] as never),
      }),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(NodeServices.layer),
  );

it.effect("authorizes live threads' recorded worktrees outside their project", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fileSystem.realPath(yield* fileSystem.makeTempDirectoryScoped());
    const [projectRoot, worktree, deletedWorktree, elsewhere] = [
      "project",
      "worktrees/thread",
      "worktrees/deleted",
      "elsewhere",
    ].map((name) => path.join(base, name));
    for (const directory of [projectRoot!, worktree!, deletedWorktree!, elsewhere!]) {
      yield* fileSystem.makeDirectory(directory, { recursive: true });
    }

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const [id, worktreePath, deletedAt] of [
        ["thread-live", worktree, null],
        ["thread-deleted", deletedWorktree, "2026-01-02T00:00:00.000Z"],
        ["thread-relative", "relative/worktree", null],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
          thread_id: id,
          project_id: "project",
          title: "Session",
          default_provider: "claude",
          runtime_mode: "auto",
          interaction_mode: "default",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: deletedAt,
          payload_json: JSON.stringify({ worktreePath }),
        })}`;
      }

      const known = yield* KnownWorkspaces.KnownWorkspaces;
      assert.isTrue(yield* known.contains(path.join(projectRoot!, "notes.md")));
      assert.isTrue(yield* known.contains(path.join(worktree!, "practice", "main.py")));
      assert.isFalse(yield* known.contains(path.join(deletedWorktree!, "main.py")));
      assert.isFalse(yield* known.contains(path.join(elsewhere!, "main.py")));
      assert.isTrue(Exit.isSuccess(yield* known.assertContains(worktree!).pipe(Effect.exit)));
    }).pipe(Effect.provide(makeLayer(projectRoot!)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
