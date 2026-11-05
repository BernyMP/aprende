import {
  LEARNING_MAX_OPTIONS,
  learningAnswerMessageHeader,
  type LearningAnswer,
  type LearningPlanEdge,
  type LearningPlanNode,
  type LearningQuestionFormat,
  type LearningQuestionPurpose,
} from "@t3tools/contracts";

export interface QuestionDraft {
  readonly purpose: LearningQuestionPurpose;
  readonly format: LearningQuestionFormat;
  readonly question: string;
  readonly options?: ReadonlyArray<string> | undefined;
  readonly correctOptions?: ReadonlyArray<number> | undefined;
  readonly allowMultiple?: boolean | undefined;
  readonly modelAnswer?: string | undefined;
  readonly explanation?: string | undefined;
  readonly planNodeId?: string | undefined;
}

export interface StoredQuestion {
  readonly id: string;
  readonly purpose: LearningQuestionPurpose;
  readonly format: LearningQuestionFormat;
  readonly prompt: string;
  readonly options: ReadonlyArray<string>;
  readonly correctOptions: ReadonlyArray<number>;
  readonly allowMultiple: boolean;
  readonly modelAnswer: string | null;
  readonly explanation: string | null;
}

/** The reason a question cannot be shown, or undefined when it is valid. */
export function questionDraftProblem(
  draft: QuestionDraft,
  planNodeIds: ReadonlySet<string> | null,
): string | undefined {
  const graded = draft.purpose !== "goal";
  if (draft.question.trim().length === 0) return "The question is empty.";
  if (draft.format === "choice") {
    const options = draft.options ?? [];
    if (options.length < 2 || options.length > LEARNING_MAX_OPTIONS)
      return `Choice questions need 2 to ${LEARNING_MAX_OPTIONS} options.`;
    if (options.some((option) => option.trim().length === 0)) return "An option is empty.";
    if (new Set(options.map((option) => option.trim())).size !== options.length)
      return "Two options are the same.";
    const correct = draft.correctOptions ?? [];
    if (correct.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length))
      return "correctOptions must be indexes into options, counting from 0.";
    if (graded && correct.length === 0)
      return "Graded questions need correctOptions, committed before the learner answers.";
    if (!graded && correct.length > 0) return "Goal questions are not graded; omit correctOptions.";
    if (correct.length > 1 && draft.allowMultiple !== true)
      return "More than one correct option needs allowMultiple.";
  } else {
    if ((draft.options ?? []).length > 0) return "Recall questions take no options.";
    if (graded && (draft.modelAnswer ?? "").trim().length === 0)
      return "Graded recall questions need modelAnswer, committed before the learner answers.";
  }
  if (graded && (draft.explanation ?? "").trim().length === 0)
    return "Graded questions need an explanation, shown after the learner answers.";
  if (draft.planNodeId !== undefined && planNodeIds !== null && !planNodeIds.has(draft.planNodeId))
    return `planNodeId "${draft.planNodeId}" is not a node of the current plan.`;
  if (
    (draft.purpose === "predict" || draft.purpose === "check") &&
    planNodeIds !== null &&
    draft.planNodeId === undefined
  )
    return "Predict and check questions need the planNodeId they teach.";
  return undefined;
}

/** The reason a plan is invalid, or undefined when it is a DAG over unique node ids. */
export function planProblem(
  nodes: ReadonlyArray<LearningPlanNode>,
  edges: ReadonlyArray<LearningPlanEdge>,
): string | undefined {
  if (nodes.length === 0) return "The plan has no nodes.";
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return `Node id "${node.id}" appears twice.`;
    ids.add(node.id);
  }
  const outgoing = new Map<string, Array<string>>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to))
      return `Edge ${edge.from} -> ${edge.to} names a node that does not exist.`;
    if (edge.from === edge.to) return `Edge ${edge.from} -> ${edge.to} points at itself.`;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): string | undefined => {
    const seen = state.get(id);
    if (seen === "done") return undefined;
    if (seen === "visiting") return `The plan has a cycle through "${id}".`;
    state.set(id, "visiting");
    for (const next of outgoing.get(id) ?? []) {
      const problem = visit(next);
      if (problem !== undefined) return problem;
    }
    state.set(id, "done");
    return undefined;
  };
  for (const id of ids) {
    const problem = visit(id);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** null when the app does not grade the question. */
export function gradeAnswer(
  question: Pick<StoredQuestion, "format" | "correctOptions">,
  selected: ReadonlyArray<number>,
  dontKnow: boolean,
): boolean | null {
  if (question.format !== "choice" || question.correctOptions.length === 0) return null;
  if (dontKnow) return false;
  const chosen = new Set(selected);
  return (
    chosen.size === question.correctOptions.length &&
    question.correctOptions.every((index) => chosen.has(index))
  );
}

/** The reason an answer cannot be accepted, or undefined. */
export function answerProblem(
  question: Pick<StoredQuestion, "format" | "options" | "allowMultiple">,
  input: { readonly selectedOptions: ReadonlyArray<number>; readonly text?: string | undefined; readonly dontKnow: boolean },
): string | undefined {
  if (input.dontKnow) return undefined;
  if (question.format === "choice") {
    if (input.selectedOptions.length === 0) return "Pick an option, or answer that you don't know.";
    if (!question.allowMultiple && input.selectedOptions.length > 1) return "Pick one option.";
    if (
      input.selectedOptions.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= question.options.length,
      )
    )
      return "That option does not exist.";
    return undefined;
  }
  return (input.text ?? "").trim().length === 0
    ? "Write an answer, or answer that you don't know."
    : undefined;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffles graded options so the tutor's ordering never hints at the answer. */
export function shuffleOptions(
  options: ReadonlyArray<string>,
  correctOptions: ReadonlyArray<number>,
  seed: string,
): { readonly options: ReadonlyArray<string>; readonly correctOptions: ReadonlyArray<number> } {
  const order = options.map((_, index) => index);
  const random = seededRandom(seed);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return {
    options: order.map((original) => options[original]!),
    correctOptions: correctOptions.map((original) => order.indexOf(original)).toSorted(),
  };
}

const optionLabel = (index: number) => String.fromCharCode(65 + index);

const describeOptions = (question: StoredQuestion, indexes: ReadonlyArray<number>) =>
  indexes.map((index) => `${optionLabel(index)}) ${question.options[index]}`).join("; ");

/** The message that hands the learner's answer back to the tutor as their next turn. */
export function formatAnswerMessage(question: StoredQuestion, answer: LearningAnswer): string {
  const lines = [learningAnswerMessageHeader(question.id), `Question: ${question.prompt}`];
  if (answer.dontKnow) {
    lines.push("Their answer: I don't know.");
  } else if (question.format === "choice") {
    lines.push(`Their answer: ${describeOptions(question, answer.selectedOptions)}`);
  } else {
    lines.push(`Their answer: ${answer.text ?? ""}`);
  }
  if (answer.correct === true) {
    lines.push("Result: correct.");
  } else if (answer.correct === false) {
    lines.push(`Result: incorrect. Correct: ${describeOptions(question, question.correctOptions)}`);
  } else if (question.format === "recall" && question.purpose !== "goal") {
    lines.push("Result: not graded by the app. Grade it against your model answer.");
  }
  if (answer.confidence !== undefined && !answer.dontKnow) {
    lines.push(`Confidence: ${answer.confidence}%`);
  }
  const thinking = answer.thinking?.trim();
  if (thinking) lines.push(`Their thinking: ${thinking}`);
  return lines.join("\n");
}
