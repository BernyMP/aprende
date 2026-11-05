import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The outbox decodes every stored request strictly, so rows of a removed effect type must go.
// The tables below were read only by scheduled tasks and pull requests.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    DELETE FROM orchestration_v2_effect_outbox
    WHERE effect_type = 'scheduled-tasks.cleanup'
  `;
  yield* sql`DROP TABLE IF EXISTS scheduled_task_webhook_deliveries`;
  yield* sql`DROP TABLE IF EXISTS scheduled_task_webhook_relay_deliveries`;
  yield* sql`DROP TABLE IF EXISTS scheduled_task_webhook_pending`;
  yield* sql`DROP TABLE IF EXISTS scheduled_task_webhook_replay_keys`;
  yield* sql`DROP TABLE IF EXISTS scheduled_tasks`;
  yield* sql`DROP TABLE IF EXISTS pull_request_files_viewed`;
  yield* sql`DROP TABLE IF EXISTS pull_request_review_guides`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_pull_requests`;
});
