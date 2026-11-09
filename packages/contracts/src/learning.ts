import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LEARNING_MAX_OPTIONS = 6;

/** The tutor's MCP tools, which clients render as learning cards instead of tool rows. */
export const LEARNING_TOOL_NAMES = [
  "ask_question",
  "pose_problem",
  "conclude_problem",
  "finish_measuring",
  "set_plan",
  "graph_search",
  "graph_record",
  "review_due",
  "set_profile",
  "get_outline",
  "propose_outline",
  "mark_topic_learned",
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

/** How sure the learner was. Optional: learners may skip it or hide it in settings. */
export const LearningConfidence = Schema.Literals(["guessing", "fairlySure", "certain"]);
export type LearningConfidence = typeof LearningConfidence.Type;

export const LEARNING_CONFIDENCE_LABELS: Record<LearningConfidence, string> = {
  guessing: "Guessing",
  fairlySure: "Fairly sure",
  certain: "Certain",
};

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

/**
 * What a practice problem asks for. `recall` produces a fact, definition or derivation from
 * memory. `discriminate` tells apart cases that look alike. `compose` combines several ideas.
 */
export const LearningProblemMode = Schema.Literals(["recall", "discriminate", "compose"]);
export type LearningProblemMode = typeof LearningProblemMode.Type;

/** `submitted` waits for the tutor's verdict; `skipped` was replaced before the learner submitted. */
export const LearningProblemStatus = Schema.Literals(["open", "submitted", "concluded", "skipped"]);
export type LearningProblemStatus = typeof LearningProblemStatus.Type;

export const LearningProblemOutcome = Schema.Literals(["solved", "partial", "missed"]);
export type LearningProblemOutcome = typeof LearningProblemOutcome.Type;

export const LearningMissType = Schema.Literals(["slip", "gap", "misconception"]);
export type LearningMissType = typeof LearningMissType.Type;

export const LearningProblemTarget = Schema.Struct({
  name: Schema.String,
  /** Set when the tutor named a proposition of the knowledge graph. */
  propositionId: Schema.NullOr(Schema.String),
});
export type LearningProblemTarget = typeof LearningProblemTarget.Type;

/** Caps on a practice workspace and its check runs. */
export const LEARNING_MAX_WORKSPACE_FILES = 20;
export const LEARNING_MAX_WORKSPACE_FILE_CHARS = 100_000;
export const LEARNING_CHECK_TIMEOUT_SECONDS = 30;
export const LEARNING_CHECK_MAX_OUTPUT_BYTES = 64 * 1024;

/** A coding problem's files. `folder` is relative to the session's folder and `files` to `folder`, both with `/`. */
export const LearningProblemWorkspace = Schema.Struct({
  folder: Schema.String,
  files: Schema.Array(Schema.String),
  /** Run in `folder` by the learner's Run button and on submit; null when the tutor gave none. */
  checkCommand: Schema.NullOr(Schema.String),
});
export type LearningProblemWorkspace = typeof LearningProblemWorkspace.Type;

/** How a check command ended. */
export const LearningCheckOutcome = Schema.Struct({
  /** null when the command timed out or could not start. */
  exitCode: Schema.NullOr(Schema.Int),
  timedOut: Schema.Boolean,
});
export type LearningCheckOutcome = typeof LearningCheckOutcome.Type;

/** One run of a workspace's check command. Output is stdout and stderr together, capped. */
export const LearningCheckRun = Schema.Struct({
  ...LearningCheckOutcome.fields,
  output: Schema.String,
  truncated: Schema.Boolean,
});
export type LearningCheckRun = typeof LearningCheckRun.Type;

export const LearningProblemAttempt = Schema.Struct({
  text: Schema.optional(Schema.String),
  /** How the check ran on submit. */
  check: Schema.optional(LearningCheckOutcome),
  gaveUp: Schema.Boolean,
  confidence: Schema.optional(LearningConfidence),
  thinking: Schema.optional(Schema.String),
  submittedAt: IsoDateTime,
});
export type LearningProblemAttempt = typeof LearningProblemAttempt.Type;

export const LearningProblemConclusion = Schema.Struct({
  outcome: LearningProblemOutcome,
  verdict: Schema.String,
  missType: Schema.optional(LearningMissType),
  retest: Schema.Boolean,
  concludedAt: IsoDateTime,
});
export type LearningProblemConclusion = typeof LearningProblemConclusion.Type;

/** What the learner may see. The model solution and unrevealed hints stay on the server until the tutor concludes. */
export const LearningProblemView = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  mode: LearningProblemMode,
  statement: Schema.String,
  targets: Schema.Array(LearningProblemTarget),
  retestOf: Schema.NullOr(Schema.String),
  status: LearningProblemStatus,
  /** The revealed hints, in order; every hint once concluded. */
  hints: Schema.Array(Schema.String),
  hintCount: Schema.Int,
  hintsUsed: Schema.Int,
  createdAt: IsoDateTime,
  attempt: Schema.NullOr(LearningProblemAttempt),
  conclusion: Schema.NullOr(LearningProblemConclusion),
  modelSolution: Schema.NullOr(Schema.String),
  workspace: Schema.NullOr(LearningProblemWorkspace),
});
export type LearningProblemView = typeof LearningProblemView.Type;

export const LEARNING_MAX_OUTLINE_TOPICS = 60;
const TopicTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const TopicSummary = Schema.String.check(Schema.isMaxLength(1_000));
const TopicId = TrimmedNonEmptyString.check(Schema.isMaxLength(80));

/**
 * Where a notebook topic stands. `known` is the learner's own claim, not something a lesson
 * checked; `learned` is set by the tutor once a lesson's checks pass. A `todo` topic with lessons
 * is in progress; that is derived, not stored.
 */
export const LearningTopicStatus = Schema.Literals(["todo", "learned", "known"]);
export type LearningTopicStatus = typeof LearningTopicStatus.Type;

export const LearningOutlineTopic = Schema.Struct({
  id: TopicId,
  title: TopicTitle,
  summary: Schema.optional(TopicSummary),
  status: LearningTopicStatus,
});
export type LearningOutlineTopic = typeof LearningOutlineTopic.Type;

/** A notebook's ordered topics; `updatedAt` is null until someone writes one. */
export const LearningOutline = Schema.Struct({
  projectId: ProjectId,
  topics: Schema.Array(LearningOutlineTopic),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type LearningOutline = typeof LearningOutline.Type;

/**
 * One change to an outline. `after` names the topic to place it after; null puts it first and
 * a missing `after` on `add` puts it last.
 */
export const LearningOutlineOp = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    title: TopicTitle,
    summary: Schema.optional(TopicSummary),
    after: Schema.optional(Schema.NullOr(TopicId)),
  }),
  Schema.Struct({
    type: Schema.Literal("rename"),
    topicId: TopicId,
    title: TopicTitle,
    summary: Schema.optional(TopicSummary),
  }),
  Schema.Struct({
    type: Schema.Literal("move"),
    topicId: TopicId,
    after: Schema.NullOr(TopicId),
  }),
  Schema.Struct({ type: Schema.Literal("remove"), topicId: TopicId }),
  Schema.Struct({
    type: Schema.Literal("setStatus"),
    topicId: TopicId,
    status: LearningTopicStatus,
  }),
]);
export type LearningOutlineOp = typeof LearningOutlineOp.Type;

/** `replaced` was pending when the tutor proposed again. */
export const LearningOutlineProposalStatus = Schema.Literals([
  "pending",
  "accepted",
  "dismissed",
  "replaced",
]);
export type LearningOutlineProposalStatus = typeof LearningOutlineProposalStatus.Type;

/** A change the tutor suggests to the notebook outline. It applies only once the learner accepts. */
export const LearningOutlineProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  threadId: ThreadId,
  ops: Schema.Array(LearningOutlineOp),
  reason: Schema.String,
  status: LearningOutlineProposalStatus,
  createdAt: IsoDateTime,
});
export type LearningOutlineProposal = typeof LearningOutlineProposal.Type;

/** A lesson's link to the outline topic it teaches. */
export const LearningLessonTopic = Schema.Struct({
  threadId: ThreadId,
  topicId: TopicId,
});
export type LearningLessonTopic = typeof LearningLessonTopic.Type;

export const LearningNotebook = Schema.Struct({
  outline: LearningOutline,
  lessons: Schema.Array(LearningLessonTopic),
  /** The proposal waiting for the learner, if any. */
  proposal: Schema.NullOr(LearningOutlineProposal),
});
export type LearningNotebook = typeof LearningNotebook.Type;

export const LearningSubscribeNotebookInput = Schema.Struct({ projectId: ProjectId });
export type LearningSubscribeNotebookInput = typeof LearningSubscribeNotebookInput.Type;

export const LearningEditOutlineInput = Schema.Struct({
  projectId: ProjectId,
  ops: Schema.Array(LearningOutlineOp).check(Schema.isMinLength(1)),
});
export type LearningEditOutlineInput = typeof LearningEditOutlineInput.Type;

export const LearningResolveProposalInput = Schema.Struct({
  proposalId: TrimmedNonEmptyString,
  accept: Schema.Boolean,
});
export type LearningResolveProposalInput = typeof LearningResolveProposalInput.Type;

export const LearningSetLessonTopicInput = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  /** null makes it a loose lesson again. */
  topicId: Schema.NullOr(TopicId),
});
export type LearningSetLessonTopicInput = typeof LearningSetLessonTopicInput.Type;

/** Derived: no assessment yet is `measure`, an assessment without a plan is `plan`, then `teach`. */
export const LearningPhase = Schema.Literals(["measure", "plan", "teach"]);
export type LearningPhase = typeof LearningPhase.Type;

export const LearningThreadState = Schema.Struct({
  threadId: ThreadId,
  phase: LearningPhase,
  questions: Schema.Array(LearningQuestionView),
  problems: Schema.Array(LearningProblemView),
  assessment: Schema.NullOr(LearningAssessment),
  plan: Schema.NullOr(LearningPlan),
  /** The plan node of the most recent question that named one. */
  currentNodeId: Schema.NullOr(Schema.String),
  /** The notebook topic this lesson teaches. */
  topic: Schema.NullOr(LearningOutlineTopic),
  /** Outline changes the tutor proposed in this lesson. */
  proposals: Schema.Array(LearningOutlineProposal),
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

export const LearningRevealHintInput = Schema.Struct({
  threadId: ThreadId,
  problemId: TrimmedNonEmptyString,
});
export type LearningRevealHintInput = typeof LearningRevealHintInput.Type;

export const LearningSubmitSolutionInput = Schema.Struct({
  threadId: ThreadId,
  problemId: TrimmedNonEmptyString,
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(LEARNING_MAX_TEXT_CHARS))),
  gaveUp: Schema.Boolean,
  confidence: Schema.optional(LearningConfidence),
  thinking: Schema.optional(Schema.String.check(Schema.isMaxLength(LEARNING_MAX_TEXT_CHARS))),
});
export type LearningSubmitSolutionInput = typeof LearningSubmitSolutionInput.Type;

export const LearningProblemResult = Schema.Struct({ problem: LearningProblemView });
export type LearningProblemResult = typeof LearningProblemResult.Type;

export const LearningRunCheckInput = LearningRevealHintInput;
export type LearningRunCheckInput = typeof LearningRunCheckInput.Type;

/** Caps on practice terminals: how many run at once, and how much output reopening replays. */
export const LEARNING_MAX_PRACTICE_TERMINALS = 4;
export const LEARNING_TERMINAL_SCROLLBACK_CHARS = 256 * 1024;
/** The most input one terminal write carries; clients split longer input. */
export const LEARNING_TERMINAL_WRITE_MAX_CHARS = 64 * 1024;

const TerminalSize = {
  cols: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  rows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
};

/** A problem's practice terminal, one per problem. */
export const LearningTerminalTarget = LearningRevealHintInput;
export type LearningTerminalTarget = typeof LearningTerminalTarget.Type;

export const LearningTerminalOpenInput = Schema.Struct({
  ...LearningTerminalTarget.fields,
  ...TerminalSize,
});
export type LearningTerminalOpenInput = typeof LearningTerminalOpenInput.Type;

export const LearningTerminalResizeInput = LearningTerminalOpenInput;
export type LearningTerminalResizeInput = typeof LearningTerminalResizeInput.Type;

export const LearningTerminalWriteInput = Schema.Struct({
  ...LearningTerminalTarget.fields,
  data: Schema.String.check(Schema.isMaxLength(LEARNING_TERMINAL_WRITE_MAX_CHARS)),
});
export type LearningTerminalWriteInput = typeof LearningTerminalWriteInput.Type;

/**
 * A practice terminal's output. `snapshot` comes first and replaces what the client shows;
 * `ended` comes last, with the shell's exit code, or null when it was closed or never open.
 */
export const LearningTerminalEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("snapshot"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("output"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("ended"), exitCode: Schema.NullOr(Schema.Int) }),
]);
export type LearningTerminalEvent = typeof LearningTerminalEvent.Type;

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

/** A session that taught part of the graph, so clients can name and group it without loading it. */
export const LearningKnowledgeSession = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  createdAt: IsoDateTime,
});
export type LearningKnowledgeSession = typeof LearningKnowledgeSession.Type;

/**
 * Where a proposition stands in spaced review. `dueAt` already counts a snooze; `box` is its
 * Leitner box, and each box doubles the wait.
 */
export const LearningReview = Schema.Struct({
  propositionId: TrimmedNonEmptyString,
  box: Schema.Int,
  dueAt: IsoDateTime,
  due: Schema.Boolean,
  lastReviewedAt: Schema.NullOr(IsoDateTime),
  snoozedUntil: Schema.NullOr(IsoDateTime),
});
export type LearningReview = typeof LearningReview.Type;

export const LearningKnowledgeView = Schema.Struct({
  ...LearningKnowledge.fields,
  sessions: Schema.Array(LearningKnowledgeSession),
  reviews: Schema.Array(LearningReview),
});
export type LearningKnowledgeView = typeof LearningKnowledgeView.Type;

/** What `review_due` gives the tutor: the most overdue first, up to its limit. */
export const LearningDueReviews = Schema.Struct({
  total: Schema.Int,
  propositions: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      name: Schema.String,
      statement: Schema.String,
      box: Schema.Int,
      dueAt: IsoDateTime,
    }),
  ),
});
export type LearningDueReviews = typeof LearningDueReviews.Type;

const LEARNING_MAX_SNOOZE_DAYS = 365;

export const LearningSnoozeReviewInput = Schema.Struct({
  propositionIds: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)),
  /** null ends the snooze. */
  days: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: LEARNING_MAX_SNOOZE_DAYS })),
  ),
});
export type LearningSnoozeReviewInput = typeof LearningSnoozeReviewInput.Type;

/** What the learner is after. Not a learning style: it changes the path, never the checks. */
export const LearnerGoalKind = Schema.Literals(["understanding", "exam", "skill", "gist"]);
export type LearnerGoalKind = typeof LearnerGoalKind.Type;

/** How often the learner expects to come back. It sets the first spaced-review interval. */
export const LearnerReturnCadence = Schema.Literals([
  "daily",
  "fewTimesAWeek",
  "weekly",
  "occasionally",
]);
export type LearnerReturnCadence = typeof LearnerReturnCadence.Type;

export const LearnerDiagrams = Schema.Literals(["often", "whenUseful", "rarely"]);
export type LearnerDiagrams = typeof LearnerDiagrams.Type;

export const LearnerExplanationLength = Schema.Literals(["brief", "standard", "detailed"]);
export type LearnerExplanationLength = typeof LearnerExplanationLength.Type;

export const LEARNER_LANGUAGE_MAX_CHARS = 80;
export const LEARNER_INTERESTS_MAX_CHARS = 300;

const profileFields = {
  goalKind: LearnerGoalKind,
  returnCadence: LearnerReturnCadence,
  language: TrimmedNonEmptyString.check(Schema.isMaxLength(LEARNER_LANGUAGE_MAX_CHARS)),
  interests: TrimmedNonEmptyString.check(Schema.isMaxLength(LEARNER_INTERESTS_MAX_CHARS)),
  diagrams: LearnerDiagrams,
  explanationLength: LearnerExplanationLength,
};

/** The learner's preferences. A field is missing until they choose it. */
export const LearnerProfile = Schema.Struct({
  goalKind: Schema.optional(profileFields.goalKind),
  returnCadence: Schema.optional(profileFields.returnCadence),
  language: Schema.optional(profileFields.language),
  interests: Schema.optional(profileFields.interests),
  diagrams: Schema.optional(profileFields.diagrams),
  explanationLength: Schema.optional(profileFields.explanationLength),
});
export type LearnerProfile = typeof LearnerProfile.Type;

/** A partial change: a missing field stays as it is, and null clears it. */
export const LearnerProfilePatch = Schema.Struct({
  goalKind: Schema.optional(Schema.NullOr(profileFields.goalKind)),
  returnCadence: Schema.optional(Schema.NullOr(profileFields.returnCadence)),
  language: Schema.optional(Schema.NullOr(profileFields.language)),
  interests: Schema.optional(Schema.NullOr(profileFields.interests)),
  diagrams: Schema.optional(Schema.NullOr(profileFields.diagrams)),
  explanationLength: Schema.optional(Schema.NullOr(profileFields.explanationLength)),
});
export type LearnerProfilePatch = typeof LearnerProfilePatch.Type;

const ANSWER_MESSAGE_PATTERN = /^\[Answer to question ([A-Za-z0-9-]+)\]/;
const SOLUTION_MESSAGE_PATTERN = /^\[Work on problem ([A-Za-z0-9-]+)\]/;

/** First line of the message that carries a learner's answer back to the tutor. */
export const learningAnswerMessageHeader = (questionId: string) =>
  `[Answer to question ${questionId}]`;

/** The question id a learner-answer message refers to, or null for any other message. */
export const learningAnswerMessageQuestionId = (text: string): string | null =>
  ANSWER_MESSAGE_PATTERN.exec(text)?.[1] ?? null;

/** First line of the message that carries a learner's work on a problem back to the tutor. */
export const learningSolutionMessageHeader = (problemId: string) =>
  `[Work on problem ${problemId}]`;

/** The problem id a learner-work message refers to, or null for any other message. */
export const learningSolutionMessageProblemId = (text: string): string | null =>
  SOLUTION_MESSAGE_PATTERN.exec(text)?.[1] ?? null;
