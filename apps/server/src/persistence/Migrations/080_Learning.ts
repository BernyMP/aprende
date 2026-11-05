import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE learning_questions (
      question_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      format TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_options_json TEXT NOT NULL,
      allow_multiple INTEGER NOT NULL,
      model_answer TEXT,
      explanation TEXT,
      plan_node_id TEXT,
      status TEXT NOT NULL,
      answer_json TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX learning_questions_thread_idx ON learning_questions(thread_id, created_at)`;

  yield* sql`
    CREATE TABLE learning_assessments (
      thread_id TEXT PRIMARY KEY,
      assessment_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE learning_plans (
      thread_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE learning_propositions (
      proposition_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      statement TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE learning_proposition_sources (
      proposition_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (proposition_id, thread_id)
    )
  `;

  yield* sql`
    CREATE TABLE learning_chains (
      chain_id TEXT PRIMARY KEY,
      premises_json TEXT NOT NULL,
      conclusion_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
});
