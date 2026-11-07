import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A proposition without a row has never been reviewed; due dates are computed on read.
  yield* sql`
    CREATE TABLE learning_reviews (
      proposition_id TEXT PRIMARY KEY,
      box INTEGER NOT NULL,
      last_reviewed_at TEXT,
      snoozed_until TEXT
    )
  `;
});
