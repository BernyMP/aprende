import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The outbox decodes every stored request strictly, so rows of a removed effect type must go.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    DELETE FROM orchestration_v2_effect_outbox
    WHERE effect_type IN ('terminal.cleanup', 'preview.cleanup')
  `;
});
