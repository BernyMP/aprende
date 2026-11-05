import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@aprende/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const createdAt = "2026-11-01T00:00:00.000Z";

layer("082_DropRetiredCleanupEffects", (it) => {
  it.effect("deletes outbox rows of removed effect types, whatever their status", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 81 });
      const rows: ReadonlyArray<readonly [string, string, string]> = [
        ["terminal-pending", "terminal.cleanup", "pending"],
        ["terminal-done", "terminal.cleanup", "succeeded"],
        ["preview-failed", "preview.cleanup", "failed"],
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

      yield* runMigrations({ toMigrationInclusive: 82 });

      const remaining = yield* sql<{ readonly effect_id: string }>`
        SELECT effect_id FROM orchestration_v2_effect_outbox ORDER BY effect_id
      `;
      assert.deepStrictEqual(
        remaining.map((row) => row.effect_id),
        ["attachments"],
      );
    }),
  );
});
