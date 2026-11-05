import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LEARNING_MAX_OPTIONS = 6;

/** The tutor's MCP tools, which clients render as learning cards instead of tool rows. */
export const LEARNING_TOOL_NAMES = [
  "ask_question",
  "finish_measuring",
  "set_plan",
  "graph_search",
  "graph_record",
] as const;
export type LearningToolName = (typeof LEARNING_TOOL_NAMES)[number];

/** The MCP tools a tutor session can see; the CLI and outside agents see the rest too. */
export const TUTOR_MCP_TOOL_NAMES: ReadonlyArray<string> = [
  ...LEARNING_TOOL_NAMES,
  "html_preview",
  "html_render",
];
const LEARNING_MAX_TEXT_CHARS = 8_000;

const BoundedText = TrimmedNonEmptyString.check(Schema.isMaxLength(LEARNING_MAX_TEXT_CHARS));

/**
 * Why the tutor asks. `goal` is ungraded (what the learner wants, how they want to learn).
 * `measure` probes prerequisites before teaching. `predict` asks for a guess before a step is
 * taught. `check` tests a step after it is taught.
 */
export const LearningQuestionPurpose = Schema.Literals(["goal", "measure", "predict", "check"]);
export type LearningQuestionPurpose = typeof LearningQuestionPurpose.Type;

/** `choice` is graded by the app; `recall` is answered in the learner's words and graded by the tutor. */
export const LearningQuestionFormat = Schema.Literals(["choice", "recall"]);
export type LearningQuestionFormat = typeof LearningQuestionFormat.Type;

export const LearningQuestionStatus = Schema.Literals(["open", "answered", "skipped"]);
export type LearningQuestionStatus = typeof LearningQuestionStatus.Type;

export const LearningConfidence = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));

export const LearningAnswer = Schema.Struct({
  selectedOptions: Schema.Array(Schema.Int),
  text: Schema.optional(Schema.String),
  dontKnow: Schema.Boolean,
  confidence: Schema.optional(LearningConfidence),
  thinking: Schema.optional(Schema.String),
  /** null when the app does not grade the question (goal and recall questions). */
  correct: Schema.NullOr(Schema.Boolean),
  answeredAt: IsoDateTime,
});
export type LearningAnswer = typeof LearningAnswer.Type;

/** What the learner may see. The committed answer is only present once the question is answered. */
export const LearningQuestionView = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  purpose: LearningQuestionPurpose,
  format: LearningQuestionFormat,
  prompt: Schema.String,
  options: Schema.Array(Schema.String),
  allowMultiple: Schema.Boolean,
  planNodeId: Schema.NullOr(Schema.String),
  status: LearningQuestionStatus,
  createdAt: IsoDateTime,
  answer: Schema.NullOr(LearningAnswer),
  reveal: Schema.NullOr(
    Schema.Struct({
      correctOptions: Schema.Array(Schema.Int),
      modelAnswer: Schema.NullOr(Schema.String),
      explanation: Schema.NullOr(Schema.String),
    }),
  ),
});
export type LearningQuestionView = typeof LearningQuestionView.Type;

export const LearningPlanNode = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  title: BoundedText,
  summary: Schema.optional(Schema.String),
});
export type LearningPlanNode = typeof LearningPlanNode.Type;

export const LearningPlanEdge = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
});
export type LearningPlanEdge = typeof LearningPlanEdge.Type;

export const LearningPlan = Schema.Struct({
  nodes: Schema.Array(LearningPlanNode),
  edges: Schema.Array(LearningPlanEdge),
  version: Schema.Int,
  updatedAt: IsoDateTime,
});
export type LearningPlan = typeof LearningPlan.Type;

export const LearningStrand = Schema.Struct({
  name: BoundedText,
  solid: Schema.String.annotate({ description: "What the learner reliably gets right." }),
  breaksAt: Schema.String.annotate({ description: "Where their understanding stops." }),
  misconceptions: Schema.optional(Schema.String),
  startFrom: Schema.String.annotate({ description: "Where teaching should begin." }),
});
export type LearningStrand = typeof LearningStrand.Type;

export const LearningAssessment = Schema.Struct({
  goal: BoundedText,
  strands: Schema.Array(LearningStrand),
  summary: Schema.optional(Schema.String),
  updatedAt: IsoDateTime,
});
export type LearningAssessment = typeof LearningAssessment.Type;

/** Derived: no assessment yet is `measure`, an assessment without a plan is `plan`, then `teach`. */
export const LearningPhase = Schema.Literals(["measure", "plan", "teach"]);
export type LearningPhase = typeof LearningPhase.Type;

export const LearningThreadState = Schema.Struct({
  threadId: ThreadId,
  phase: LearningPhase,
  questions: Schema.Array(LearningQuestionView),
  assessment: Schema.NullOr(LearningAssessment),
  plan: Schema.NullOr(LearningPlan),
  /** The plan node of the most recent question that named one. */
  currentNodeId: Schema.NullOr(Schema.String),
});
export type LearningThreadState = typeof LearningThreadState.Type;

export const LearningProposition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  statement: Schema.String,
  createdAt: IsoDateTime,
  sourceThreadIds: Schema.Array(ThreadId),
});
export type LearningProposition = typeof LearningProposition.Type;

export const LearningChain = Schema.Struct({
  id: TrimmedNonEmptyString,
  premises: Schema.Array(TrimmedNonEmptyString),
  conclusion: TrimmedNonEmptyString,
  sourceThreadId: ThreadId,
  createdAt: IsoDateTime,
});
export type LearningChain = typeof LearningChain.Type;

export class LearningError extends Schema.TaggedError<LearningError>()("LearningError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const LearningSubscribeThreadInput = Schema.Struct({ threadId: ThreadId });
export type LearningSubscribeThreadInput = typeof LearningSubscribeThreadInput.Type;

export const LearningAnswerInput = Schema.Struct({
  threadId: ThreadId,
  questionId: TrimmedNonEmptyString,
  selectedOptions: Schema.Array(Schema.Int),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(LEARNING_MAX_TEXT_CHARS))),
  dontKnow: Schema.Boolean,
  confidence: Schema.optional(LearningConfidence),
  thinking: Schema.optional(Schema.String.check(Schema.isMaxLength(LEARNING_MAX_TEXT_CHARS))),
});
export type LearningAnswerInput = typeof LearningAnswerInput.Type;

export const LearningAnswerResult = Schema.Struct({ question: LearningQuestionView });
export type LearningAnswerResult = typeof LearningAnswerResult.Type;

export const LearningTutorPrompt = Schema.Struct({
  prompt: Schema.String,
  defaultPrompt: Schema.String,
  isDefault: Schema.Boolean,
});
export type LearningTutorPrompt = typeof LearningTutorPrompt.Type;

export const LearningSetTutorPromptInput = Schema.Struct({
  /** null restores the default. */
  prompt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200_000))),
});
export type LearningSetTutorPromptInput = typeof LearningSetTutorPromptInput.Type;

export const LearningKnowledge = Schema.Struct({
  propositions: Schema.Array(LearningProposition),
  chains: Schema.Array(LearningChain),
});
export type LearningKnowledge = typeof LearningKnowledge.Type;

const ANSWER_MESSAGE_PATTERN = /^\[Answer to question ([A-Za-z0-9-]+)\]/;

/** First line of the message that carries a learner's answer back to the tutor. */
export const learningAnswerMessageHeader = (questionId: string) =>
  `[Answer to question ${questionId}]`;

/** The question id a learner-answer message refers to, or null for any other message. */
export const learningAnswerMessageQuestionId = (text: string): string | null =>
  ANSWER_MESSAGE_PATTERN.exec(text)?.[1] ?? null;
