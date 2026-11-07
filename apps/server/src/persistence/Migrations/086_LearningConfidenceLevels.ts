import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Confidence was a 0-100 slider; it is now one of three levels.
  yield* sql`
    UPDATE learning_questions
    SET answer_json = json_set(answer_json, '$.confidence',
      CASE
        WHEN json_extract(answer_json, '$.confidence') < 40 THEN 'guessing'
        WHEN json_extract(answer_json, '$.confidence') < 80 THEN 'fairlySure'
        ELSE 'certain'
      END)
    WHERE json_type(answer_json, '$.confidence') = 'integer'
  `;
  yield* sql`
    UPDATE learning_problems
    SET attempt_json = json_set(attempt_json, '$.confidence',
      CASE
        WHEN json_extract(attempt_json, '$.confidence') < 40 THEN 'guessing'
        WHEN json_extract(attempt_json, '$.confidence') < 80 THEN 'fairlySure'
        ELSE 'certain'
      END)
    WHERE json_type(attempt_json, '$.confidence') = 'integer'
  `;
});
