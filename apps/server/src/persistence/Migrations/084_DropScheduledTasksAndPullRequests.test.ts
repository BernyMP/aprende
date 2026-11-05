import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@aprende/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const createdAt = "2026-11-05T00:00:00.000Z";
const droppedTables = [
  "projection_thread_pull_requests",
  "pull_request_files_viewed",
  "pull_request_review_guides",
  "scheduled_task_webhook_deliveries",
  "scheduled_task_webhook_pending",
  "scheduled_task_webhook_relay_deliveries",
  "scheduled_task_webhook_replay_keys",
  "scheduled_tasks",
];

layer("084_DropScheduledTasksAndPullRequests", (it) => {
  it.effect("deletes scheduled-task cleanup rows and drops the tables only removed code read", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 83 });
      const tables = () =>
        sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name IN ${sql.in(droppedTables)}
          ORDER BY name
        `.pipe(Effect.map((rows) => rows.map((row) => row.name)));
      assert.deepStrictEqual(yield* tables(), droppedTables);
      const rows: ReadonlyArray<readonly [string, string, string]> = [
        ["scheduled-pending", "scheduled-tasks.cleanup", "pending"],
        ["scheduled-done", "scheduled-tasks.cleanup", "succeeded"],
        ["attachments", "attachment.cleanup", "pending"],
      ];
      for (const [id, type, status] of rows) {
        yield* sql`
          INSERT INTO orchestration_v2_effect_outbox (
            effect_id, command_id, thread_id, effect_type, payload_json, status,
            available_at, created_at, updated_at
          ) VALUES (
            ${id}, 'command-1', 'thread-1', ${type}, ${JSON.stringify({ type })}, ${status},
            ${createdAt}, ${createdAt}, ${createdAt}
          )
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 84 });

      const remaining = yield* sql<{ readonly effect_id: string }>`
        SELECT effect_id FROM orchestration_v2_effect_outbox ORDER BY effect_id
      `;
      assert.deepStrictEqual(
        remaining.map((row) => row.effect_id),
        ["attachments"],
      );
      assert.deepStrictEqual(yield* tables(), []);
    }),
  );
});
