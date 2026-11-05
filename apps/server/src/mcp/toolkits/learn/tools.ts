import {
  LEARNING_MAX_OPTIONS,
  LearningKnowledge,
  LearningPlanEdge,
  LearningPlanNode,
  LearningQuestionFormat,
  LearningQuestionPurpose,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as LearningService from "../../../learning/LearningService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_000));

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  LearningService.LearningService,
];

const AskQuestionTool = Tool.make("ask_question", {
  description: `Show the learner one question as a card. Commit the answer before they see it. After calling, end your turn without writing more: the answer, their confidence (0-100) and their thinking arrive as their next message. Asking a new question replaces an unanswered one.`,
  parameters: Schema.Struct({
    purpose: LearningQuestionPurpose.annotate({
      description:
        "goal: ungraded (what they want, how they like to learn). measure: probe a prerequisite. predict: a guess before a step is taught. check: apply a step after teaching it.",
    }),
    format: LearningQuestionFormat.annotate({
      description: "choice: options the app grades. recall: free text you grade next turn.",
    }),
    question: Text,
    options: Schema.optional(
      Schema.Array(Text).annotate({
        description: `choice only: 2 to ${LEARNING_MAX_OPTIONS} plain claims of similar length and form. The app shuffles graded options.`,
      }),
    ),
    correctOptions: Schema.optional(
      Schema.Array(Schema.Int).annotate({
        description: "choice only: indexes of the correct options, counting from 0. Omit for goal questions.",
      }),
    ),
    allowMultiple: Schema.optional(Schema.Boolean),
    modelAnswer: Schema.optional(
      Text.annotate({ description: "recall only: the answer you will grade against." }),
    ),
    explanation: Schema.optional(
      Text.annotate({
        description: "Why the answer is right, shown after they answer. Required unless purpose is goal.",
      }),
    ),
    planNodeId: Schema.optional(
      Schema.String.annotate({
        description: "The plan node this question teaches. Required for predict and check once a plan exists.",
      }),
    ),
  }),
  success: Schema.Struct({ questionId: Schema.String, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Ask the learner")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const FinishMeasuringTool = Tool.make("finish_measuring", {
  description:
    "Record where the learner's understanding ends, once measuring is done. Shown to them as a summary card. Then plan with set_plan.",
  parameters: Schema.Struct({
    goal: Text.annotate({ description: "The concrete goal, in a sentence." }),
    strands: Schema.Array(
      Schema.Struct({
        name: Text,
        solid: Schema.String.annotate({ description: "What they reliably get right." }),
        breaksAt: Schema.String.annotate({ description: "Where their understanding stops." }),
        misconceptions: Schema.optional(Schema.String),
        startFrom: Schema.String.annotate({ description: "Where teaching should begin." }),
      }),
    ),
    summary: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Finish measuring")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SetPlanTool = Tool.make("set_plan", {
  description:
    "Set or replace the learning plan: a dependency map from what the learner holds to the goal. An edge from A to B means A must be understood before B. Must be acyclic. Keep node ids stable when you revise it. The learner sees it live.",
  parameters: Schema.Struct({
    nodes: Schema.Array(LearningPlanNode),
    edges: Schema.Array(LearningPlanEdge),
  }),
  success: Schema.Struct({ version: Schema.Int, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Set the plan")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GraphSearchTool = Tool.make("graph_search", {
  description:
    "Search the learner's knowledge graph: propositions taught in earlier sessions, and the chains that derive them. Every word of the query must match. Omit the query to list the most recent.",
  parameters: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
  }),
  success: LearningKnowledge,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Search what they know")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GraphRecordTool = Tool.make("graph_record", {
  description:
    "Add what this session taught to the knowledge graph. Propositions are short claims that make sense on their own. When one is the same idea as an existing proposition (find it with graph_search), set sameAs to its id instead of duplicating it. Chains say which propositions together imply another; refer to propositions by their key here or an existing id.",
  parameters: Schema.Struct({
    propositions: Schema.Array(
      Schema.Struct({
        key: Schema.String.check(Schema.isMinLength(1)).annotate({
          description: "Your local name for it within this call.",
        }),
        name: Text.annotate({ description: "A few words." }),
        statement: Text,
        sameAs: Schema.optional(Schema.String),
      }),
    ),
    chains: Schema.Array(
      Schema.Struct({
        premises: Schema.Array(Schema.String),
        conclusion: Schema.String,
      }),
    ),
  }),
  success: Schema.Struct({
    propositions: Schema.Array(Schema.Struct({ key: Schema.String, id: Schema.String })),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Record what they learned")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const LearnToolkit = Toolkit.make(
  AskQuestionTool,
  FinishMeasuringTool,
  SetPlanTool,
  GraphSearchTool,
  GraphRecordTool,
);
