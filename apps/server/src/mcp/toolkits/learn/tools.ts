import {
  LEARNING_CHECK_TIMEOUT_SECONDS,
  LEARNING_MAX_OPTIONS,
  LEARNING_MAX_WORKSPACE_FILES,
  LearnerProfile,
  LearnerProfilePatch,
  LearningDueReviews,
  LearningKnowledge,
  LearningMissType,
  LearningOutlineOp,
  LearningOutlineTopic,
  LearningPlanEdge,
  LearningPlanNode,
  LearningProblemMode,
  LearningProblemOutcome,
  LearningQuestionFormat,
  LearningQuestionPurpose,
  OrchestratorMcpFailure,
} from "@aprende/contracts";
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
  description: `Show the learner one question as a card. Commit the answer before they see it. After calling, end your turn without writing more: the answer, their confidence (guessing, fairly sure or certain) if they rated it, and their thinking arrive as their next message. Asking a new question replaces an unanswered one.`,
  parameters: Schema.Struct({
    purpose: LearningQuestionPurpose.annotate({
      description:
        "goal: ungraded (what they want, how they like to learn). measure: probe a prerequisite. predict: a guess before a step is taught. check: apply a step after teaching it. predict and check need a plan from set_plan.",
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
        description:
          "choice only: indexes of the correct options, counting from 0. Omit for goal questions.",
      }),
    ),
    allowMultiple: Schema.optional(Schema.Boolean),
    modelAnswer: Schema.optional(
      Text.annotate({ description: "recall only: the answer you will grade against." }),
    ),
    explanation: Schema.optional(
      Text.annotate({
        description:
          "Why the answer is right, shown after they answer. Required unless purpose is goal.",
      }),
    ),
    planNodeId: Schema.optional(
      Schema.String.annotate({
        description: "The plan node this question teaches. Required for predict and check.",
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

const PoseProblemTool = Tool.make("pose_problem", {
  description: `Show the learner one practice problem as a card. Commit a complete model solution and graded hints before they see it. For programming practice, add a workspace: the app writes your starter files into a new project folder, where the learner edits and runs them. After calling, end your turn without writing more: their work, the hints they used, their confidence (guessing, fairly sure or certain) if they rated it, and their thinking arrive as their next message. Posing replaces an unanswered question or problem.`,
  parameters: Schema.Struct({
    mode: LearningProblemMode.annotate({
      description:
        "recall: produce a fact, definition or derivation from memory. discriminate: tell apart cases that look alike, or spot which idea applies. compose: combine several ideas to solve something new.",
    }),
    statement: Text,
    targets: Schema.Array(Text).annotate({
      description:
        "What it practices: proposition ids from graph_search, or short names for ideas not in the graph.",
    }),
    modelSolution: Text.annotate({
      description: "A complete worked solution. Shown after you conclude.",
    }),
    hints: Schema.Array(Text).annotate({
      description:
        "1 to 3 hints, gentlest first. Each points to the next move without giving the answer.",
    }),
    retestOf: Schema.optional(
      Schema.String.annotate({
        description: "The id of an earlier problem this retests in a new form.",
      }),
    ),
    workspace: Schema.optional(
      Schema.Struct({
        name: Schema.optional(
          Schema.String.annotate({ description: "A short folder name, like fizzbuzz." }),
        ),
        files: Schema.Array(
          Schema.Struct({
            path: Schema.String.annotate({ description: "Relative, with /, like src/main.py." }),
            contents: Schema.String.annotate({
              description: "Starter code that leaves out the part to write. Never the solution.",
            }),
          }),
        ).annotate({
          description: `1 to ${LEARNING_MAX_WORKSPACE_FILES} files, the one to edit first.`,
        }),
        checkCommand: Schema.optional(
          Schema.String.annotate({
            description: `Run in the folder by the learner and on submit, stopped after ${LEARNING_CHECK_TIMEOUT_SECONDS} s. Test the behavior asked for, like \`python3 -m unittest\`.`,
          }),
        ),
      }),
    ),
  }),
  success: Schema.Struct({ problemId: Schema.String, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Pose a problem")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const ConcludeProblemTool = Tool.make("conclude_problem", {
  description:
    "Judge the learner's submitted work on a problem against your model solution. They then see your verdict, the model solution and every hint. The app counts the hints they used.",
  parameters: Schema.Struct({
    problemId: Schema.String,
    outcome: LearningProblemOutcome.annotate({
      description:
        "solved: right and complete. partial: the right idea with a gap or an error. missed: wrong, or no real attempt.",
    }),
    verdict: Text.annotate({
      description: "Short feedback to the learner: what held, and where their work went wrong.",
    }),
    missType: Schema.optional(
      LearningMissType.annotate({
        description:
          "partial or missed only. slip: they know it but erred. gap: a missing piece. misconception: a wrong idea they hold.",
      }),
    ),
    retest: Schema.Boolean.annotate({
      description:
        "true to pose it again in a new form before practice ends: after a miss, or a right answer given with low confidence.",
    }),
  }),
  success: Schema.Struct({ message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Conclude a problem")
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

const ReviewDueTool = Tool.make("review_due", {
  description:
    "List the propositions due for spaced review, most overdue first. Review them with pose_problem, naming their ids in targets: the outcome you give in conclude_problem schedules the next review.",
  parameters: Schema.Struct({
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  }),
  success: LearningDueReviews,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List what is due for review")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SetProfileTool = Tool.make("set_profile", {
  description:
    "Save the learner's preferences. Save only what they chose on a card or asked for in their own words. Fields you leave out stay as they are; null clears one.",
  parameters: LearnerProfilePatch.annotate({
    description:
      "goalKind: understanding, exam, skill or gist. returnCadence: how often they will come back to study. language: the language to teach in. interests: what to draw examples from. diagrams and explanationLength: comfort, not a learning style.",
  }),
  success: Schema.Struct({ profile: LearnerProfile, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Save their preferences")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetOutlineTool = Tool.make("get_outline", {
  description:
    "Read the outline of the notebook this session is in: the learner's ordered topics for the subject, each todo, learning, learned (a lesson checked it) or known (the learner says so, unchecked). Also names this lesson's topic and whether a suggestion of yours still waits for the learner.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    inNotebook: Schema.Boolean.annotate({
      description: "false outside a notebook: there is no outline, so skip outline work.",
    }),
    notebook: Schema.NullOr(Schema.String),
    topics: Schema.Array(LearningOutlineTopic),
    lessonTopicId: Schema.NullOr(Schema.String).annotate({
      description: "The topic this lesson teaches; null for a lesson on no topic.",
    }),
    pendingProposal: Schema.Boolean,
    message: Schema.optional(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read the notebook outline")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ProposeOutlineTool = Tool.make("propose_outline", {
  description:
    "Suggest a change to the notebook outline. The learner owns it: they see your suggestion as a card and accept or dismiss it, so nothing changes until they do. A new suggestion replaces one still waiting. Name topics by id from get_outline; `after` places a topic after another, null puts it first, and leaving it out of add puts it last. Keep teaching after calling.",
  parameters: Schema.Struct({
    ops: Schema.Array(LearningOutlineOp).annotate({
      description:
        "Applied in order. add a topic, rename one, move one, remove one, or setStatus (todo, learning, learned, known).",
    }),
    reason: Text.annotate({ description: "One sentence the learner reads: why this change." }),
  }),
  success: Schema.Struct({ proposalId: Schema.String, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Suggest an outline change")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const SetTopicStatusTool = Tool.make("set_topic_status", {
  description:
    "Mark this lesson's outline topic: learned once its checks pass and the idea feels obvious to the learner, or back to learning. Only this lesson's own topic; suggest changes to others with propose_outline.",
  parameters: Schema.Struct({
    status: Schema.Literals(["learning", "learned"]),
  }),
  success: Schema.Struct({ message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Mark the lesson's topic")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const LearnToolkit = Toolkit.make(
  AskQuestionTool,
  PoseProblemTool,
  ConcludeProblemTool,
  FinishMeasuringTool,
  SetPlanTool,
  GraphSearchTool,
  GraphRecordTool,
  ReviewDueTool,
  SetProfileTool,
  GetOutlineTool,
  ProposeOutlineTool,
  SetTopicStatusTool,
);
