import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A notebook is a project; a project without a row has an empty outline.
  yield* sql`
    CREATE TABLE learning_outlines (
      project_id TEXT PRIMARY KEY,
      outline_json TEXT NOT NULL
    )
  `;
  // Written before the lesson's thread exists, so the tutor's first turn already sees its topic;
  // project_id lets the notebook list the link before the thread reaches the projection.
  yield* sql`
    CREATE TABLE learning_lesson_topics (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      topic_id TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX learning_lesson_topics_project ON learning_lesson_topics (project_id)`;
  yield* sql`
    CREATE TABLE learning_outline_proposals (
      proposal_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      ops_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX learning_outline_proposals_project ON learning_outline_proposals (project_id, status)
  `;
});
