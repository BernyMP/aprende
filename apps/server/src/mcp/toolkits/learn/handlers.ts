import { OrchestratorMcpFailure, type LearningError } from "@aprende/contracts";
import * as Effect from "effect/Effect";

import * as LearningService from "../../../learning/LearningService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { LearnToolkit } from "./tools.ts";

const toFailure = (error: LearningError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const callerThread = Effect.fn("LearnTools.callerThread")(function* (tool: string) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, tool);
  return thread.threadId;
});

// These tools change only the caller's own learning record, so read-only sandboxes may use them.
const handlers = {
  ask_question: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread("ask_question");
      const learning = yield* LearningService.LearningService;
      const { questionId } = yield* learning
        .askQuestion(threadId, input)
        .pipe(Effect.mapError(toFailure));
      return {
        questionId,
        message:
          "The learner sees the question now. End your turn without writing more; their answer arrives as their next message.",
      };
    }),
  ),
  pose_problem: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread("pose_problem");
      const learning = yield* LearningService.LearningService;
      const { problemId } = yield* learning
        .poseProblem(threadId, input)
        .pipe(Effect.mapError(toFailure));
      return {
        problemId,
        message:
          "The learner sees the problem now. End your turn without writing more; their work arrives as their next message.",
      };
    }),
  ),
  conclude_problem: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread("conclude_problem");
      const learning = yield* LearningService.LearningService;
      yield* learning.concludeProblem(threadId, input).pipe(Effect.mapError(toFailure));
      return {
        message:
          "The learner sees your verdict and the model solution now. After a miss, repair before the next problem.",
      };
    }),
  ),
  finish_measuring: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread("finish_measuring");
      const learning = yield* LearningService.LearningService;
      yield* learning.finishMeasuring(threadId, input).pipe(Effect.mapError(toFailure));
      return { message: "Recorded and shown to the learner. Plan next with set_plan." };
    }),
  ),
  set_plan: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread("set_plan");
      const learning = yield* LearningService.LearningService;
      const { version } = yield* learning.setPlan(threadId, input).pipe(Effect.mapError(toFailure));
      return { version, message: "The learner sees this plan now." };
    }),
  ),
  graph_search: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      return yield* learning.searchGraph(input).pipe(Effect.mapError(toFailure));
    }),
  ),
  graph_record: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const threadId = yield* callerThread("graph_record");
      const learning = yield* LearningService.LearningService;
      return yield* learning.recordGraph(threadId, input).pipe(Effect.mapError(toFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof LearnToolkit.tools>;

export const layer = McpToolAccess.toLayer(LearnToolkit, handlers);
