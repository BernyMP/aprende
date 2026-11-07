import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@aprende/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const createdAt = "2026-11-05T00:00:00.000Z";

layer("086_LearningConfidenceLevels", (it) => {
  it.effect("turns slider percentages into levels and leaves other answers alone", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 85 });
      const answers: ReadonlyArray<readonly [string, string | null]> = [
        ["q-low", `{"selectedOptions":[0],"dontKnow":false,"confidence":35,"correct":true}`],
        ["q-mid", `{"selectedOptions":[0],"dontKnow":false,"confidence":40,"correct":true}`],
        ["q-high", `{"selectedOptions":[0],"dontKnow":false,"confidence":80,"correct":false}`],
        ["q-none", `{"selectedOptions":[],"dontKnow":true,"correct":false}`],
        ["q-open", null],
      ];
      for (const [id, answer] of answers) {
        yield* sql`
          INSERT INTO learning_questions (
            question_id, thread_id, purpose, format, prompt, options_json, correct_options_json,
            allow_multiple, status, answer_json, created_at
          ) VALUES (${id}, 't', 'check', 'choice', 'p', '[]', '[]', 0, 'answered', ${answer}, ${createdAt})
        `;
      }
      yield* sql`
        INSERT INTO learning_problems (
          problem_id, thread_id, mode, statement, targets_json, model_solution, hints_json,
          hints_used, status, attempt_json, created_at
        ) VALUES ('p1', 't', 'recall', 's', '[]', 'm', '[]', 0, 'submitted',
          '{"gaveUp":false,"confidence":95,"submittedAt":"x"}', ${createdAt})
      `;

      yield* runMigrations({ toMigrationInclusive: 86 });

      const questions = yield* sql<{ readonly question_id: string; readonly level: unknown }>`
        SELECT question_id, json_extract(answer_json, '$.confidence') AS level
        FROM learning_questions ORDER BY question_id
      `;
      assert.deepStrictEqual(
        questions.map((row) => [row.question_id, row.level]),
        [
          ["q-high", "certain"],
          ["q-low", "guessing"],
          ["q-mid", "fairlySure"],
          ["q-none", null],
          ["q-open", null],
        ],
      );
      const [problem] = yield* sql<{ readonly level: unknown }>`
        SELECT json_extract(attempt_json, '$.confidence') AS level FROM learning_problems
      `;
      assert.strictEqual(problem?.level, "certain");
    }),
  );
});
