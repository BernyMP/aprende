import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE learning_problems (
      problem_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      statement TEXT NOT NULL,
      targets_json TEXT NOT NULL,
      model_solution TEXT NOT NULL,
      hints_json TEXT NOT NULL,
      hints_used INTEGER NOT NULL,
      retest_of TEXT,
      status TEXT NOT NULL,
      attempt_json TEXT,
      conclusion_json TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX learning_problems_thread_idx ON learning_problems(thread_id, created_at)`;
});
