import {
  isBlankStrandPhrase,
  LEARNING_ASSESSMENT_SUMMARY_MAX_CHARS,
  LEARNING_CHECK_TIMEOUT_SECONDS,
  LEARNING_MAX_OPTIONS,
  LEARNING_MAX_OUTLINE_TOPICS,
  LEARNING_MAX_PROBLEM_PART_CHARS,
  LEARNING_MAX_PROBLEM_PARTS,
  LEARNING_MAX_WORKSPACE_FILE_CHARS,
  LEARNING_MAX_WORKSPACE_FILES,
  LEARNING_STRAND_PHRASE_MAX_CHARS,
  learningAnswerMessageHeader,
  learningSolutionMessageHeader,
  type LearningAnswer,
  type LearningCheckRun,
  type LearningMissType,
  type LearningOutlineOp,
  type LearningOutlineTopic,
  type LearningProblemAttempt,
  type LearningProblemMode,
  type LearningProblemOutcome,
  type LearningProblemTarget,
  type LearningProblemWorkspace,
  type LearningPlanEdge,
  type LearningPlanNode,
  type LearningQuestionFormat,
  type LearningQuestionPurpose,
  type LearningStrand,
  type LearningStrandLevel,
} from "@aprende/contracts";

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
  if (draft.purpose === "predict" || draft.purpose === "check") {
    if (planNodeIds === null)
      return "Teach after planning: call finish_measuring, then set_plan, then ask predict and check questions on its nodes. Use measure questions until then.";
    if (draft.planNodeId === undefined)
      return "Predict and check questions need the planNodeId they teach.";
  }
  return undefined;
}

export interface StrandDraft {
  readonly name: string;
  readonly level: LearningStrandLevel;
  readonly solid?: string | undefined;
  readonly breaksAt?: string | undefined;
  readonly misconceptions?: string | undefined;
}

const STRAND_PHRASES = ["name", "solid", "breaksAt", "misconceptions"] as const;

/** The reason an assessment is refused, or undefined when the learner can read it at a glance. */
export function assessmentProblem(input: {
  readonly strands: ReadonlyArray<StrandDraft>;
  readonly summary?: string | undefined;
}): string | undefined {
  for (const strand of input.strands) {
    for (const field of STRAND_PHRASES) {
      if ((strand[field]?.trim().length ?? 0) > LEARNING_STRAND_PHRASE_MAX_CHARS)
        return `Shorten ${field} of "${strand.name.trim().slice(0, 40)}" to one phrase, ${LEARNING_STRAND_PHRASE_MAX_CHARS} characters at most. The learner reads it at a glance; keep the detail for teaching.`;
    }
  }
  if ((input.summary?.trim().length ?? 0) > LEARNING_ASSESSMENT_SUMMARY_MAX_CHARS)
    return `Shorten the summary to one or two sentences, ${LEARNING_ASSESSMENT_SUMMARY_MAX_CHARS} characters at most.`;
  return undefined;
}

/** A strand as stored: trimmed, without phrases that say nothing, like "None observed." */
export function assessedStrand(draft: StrandDraft): LearningStrand {
  const phrase = (value: string | undefined) =>
    isBlankStrandPhrase(value) ? undefined : value?.trim();
  const solid = phrase(draft.solid);
  const breaksAt = phrase(draft.breaksAt);
  const misconceptions = phrase(draft.misconceptions);
  return {
    name: draft.name.trim(),
    level: draft.level,
    ...(solid === undefined ? {} : { solid }),
    ...(breaksAt === undefined ? {} : { breaksAt }),
    ...(misconceptions === undefined ? {} : { misconceptions }),
  };
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
  input: {
    readonly selectedOptions: ReadonlyArray<number>;
    readonly text?: string | undefined;
    readonly dontKnow: boolean;
  },
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
  return lines.join("\n");
}

const LEARNING_MAX_HINTS = 3;

export interface WorkspaceDraft {
  readonly name?: string | undefined;
  readonly files: ReadonlyArray<{ readonly path: string; readonly contents: string }>;
  readonly checkCommand?: string | undefined;
}

export interface ProblemDraft {
  readonly mode: LearningProblemMode;
  readonly statement: string;
  readonly parts?: ReadonlyArray<string> | undefined;
  readonly targets: ReadonlyArray<string>;
  readonly modelSolution: string;
  readonly hints: ReadonlyArray<string>;
  readonly retestOf?: string | undefined;
  readonly workspace?: WorkspaceDraft | undefined;
}

const LEARNING_MAX_PATH_CHARS = 200;
const LEARNING_MAX_CHECK_COMMAND_CHARS = 1_000;

/** The reason a starter file cannot be written at this path inside its practice folder, or undefined. */
function workspacePathProblem(path: string): string | undefined {
  if (path.length === 0 || path.length > LEARNING_MAX_PATH_CHARS)
    return `File path "${path}" must be 1 to ${LEARNING_MAX_PATH_CHARS} characters.`;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path))
    return `File path "${path}" must be relative to the practice folder.`;
  if (path.includes("\\")) return `File path "${path}" must separate folders with /.`;
  // Characters Windows cannot store in a file name, and control characters anywhere.
  if (/[<>:"|?*]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32))
    return `File path "${path}" has a character files cannot use.`;
  if (path.split("/").some((part) => part === "" || part === "." || part === ".."))
    return `File path "${path}" must not have empty, "." or ".." parts.`;
  return undefined;
}

/** The reason a coding workspace cannot be created, or undefined when it is valid. */
function workspaceDraftProblem(workspace: WorkspaceDraft): string | undefined {
  const { files } = workspace;
  if (files.length === 0 || files.length > LEARNING_MAX_WORKSPACE_FILES)
    return `Give 1 to ${LEARNING_MAX_WORKSPACE_FILES} starter files.`;
  const seen: Array<string> = [];
  for (const file of files) {
    const problem = workspacePathProblem(file.path);
    if (problem !== undefined) return problem;
    if (file.contents.length > LEARNING_MAX_WORKSPACE_FILE_CHARS)
      return `File "${file.path}" is longer than ${LEARNING_MAX_WORKSPACE_FILE_CHARS} characters.`;
    // Compare without case, since the learner's file system may ignore it.
    const key = file.path.toLowerCase();
    if (
      seen.some(
        (other) => other === key || other.startsWith(`${key}/`) || key.startsWith(`${other}/`),
      )
    )
      return `File "${file.path}" clashes with another starter file.`;
    seen.push(key);
  }
  const command = workspace.checkCommand;
  if (
    command !== undefined &&
    (command.trim().length === 0 || command.length > LEARNING_MAX_CHECK_COMMAND_CHARS)
  )
    return `checkCommand must be 1 to ${LEARNING_MAX_CHECK_COMMAND_CHARS} characters, or omitted.`;
  return undefined;
}

/** Whether a practice folder's files or check run Python, which aprende downloads on first use. */
export const workspaceUsesPython = (workspace: {
  readonly files: ReadonlyArray<string>;
  readonly checkCommand: string | null;
}): boolean =>
  workspace.files.some((file) => /\.py$/i.test(file)) ||
  /\bpython3?\b/.test(workspace.checkCommand ?? "");

/** The program a check starts with, when it is a bare name a shell looks up, like `go` in `go test`. */
export const checkProgram = (command: string): string | undefined =>
  /^\s*([\w.+-]+)(?=\s|$)/.exec(command)?.[1];

/** Tells the tutor why a problem whose check cannot start was not shown. */
export const missingProgramMessage = (program: string) =>
  `\`${program}\` is not installed on the learner's computer, so this check cannot run and the problem was not shown. aprende brings \`python3\` and \`node\`: pose the problem with one of them, or write to the learner that \`${program}\` is missing and what to install. After installing they must quit and reopen aprende before you pose it again, or aprende will not find the new program.`;

/** A readable, unique folder name for a problem's workspace, such as `fizzbuzz-1a2b3c4d`. */
export function practiceFolderName(name: string, problemId: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "problem";
  const shortId = problemId
    .replace(/^prob-/, "")
    .replaceAll("-", "")
    .slice(0, 8);
  return `${slug}-${shortId}`;
}

/** The reason a problem cannot be shown, or undefined when it is valid. */
export function problemDraftProblem(draft: ProblemDraft): string | undefined {
  if (draft.statement.trim().length === 0) return "The problem statement is empty.";
  if (draft.targets.length === 0 || draft.targets.some((target) => target.trim().length === 0))
    return "Name at least one target: a proposition id from graph_search, or a short name.";
  if (draft.modelSolution.trim().length === 0)
    return "Commit a complete modelSolution before the learner sees the problem.";
  if (draft.hints.length === 0 || draft.hints.length > LEARNING_MAX_HINTS)
    return `Give 1 to ${LEARNING_MAX_HINTS} hints, gentlest first.`;
  if (draft.hints.some((hint) => hint.trim().length === 0)) return "A hint is empty.";
  const parts = draft.parts ?? [];
  if (parts.length > 0) {
    if (draft.workspace !== undefined)
      return "A workspace problem is answered in its files, so it takes no parts.";
    if (parts.length < 2 || parts.length > LEARNING_MAX_PROBLEM_PARTS)
      return `Give 2 to ${LEARNING_MAX_PROBLEM_PARTS} parts, or none for one piece of work.`;
    if (parts.some((part) => part.trim().length === 0)) return "A part is empty.";
    if (parts.some((part) => part.trim().length > LEARNING_MAX_PROBLEM_PART_CHARS))
      return `Keep each part to ${LEARNING_MAX_PROBLEM_PART_CHARS} characters: it names one answer. The shared setup belongs in the statement.`;
  }
  return draft.workspace === undefined ? undefined : workspaceDraftProblem(draft.workspace);
}

/** The reason a verdict cannot be recorded, or undefined. */
export function conclusionProblem(input: {
  readonly outcome: LearningProblemOutcome;
  readonly missType?: LearningMissType | undefined;
}): string | undefined {
  return input.outcome === "solved" && input.missType !== undefined
    ? "missType is only for partial or missed problems."
    : undefined;
}

/** The reason the learner's work cannot be accepted, or undefined. Workspace work lives in its files. */
export function solutionProblem(
  input: {
    readonly text?: string | undefined;
    readonly answers?: ReadonlyArray<string> | undefined;
    readonly gaveUp: boolean;
  },
  problem: { readonly hasWorkspace: boolean; readonly partCount: number },
): string | undefined {
  if (problem.partCount > 0) {
    const answers = input.answers ?? [];
    if (answers.length > 0 && answers.length !== problem.partCount)
      return `This problem has ${problem.partCount} parts; send one answer for each.`;
    return !input.gaveUp && answers.every((answer) => answer.trim().length === 0)
      ? "Answer at least one part, or give up."
      : undefined;
  }
  return !problem.hasWorkspace && !input.gaveUp && (input.text ?? "").trim().length === 0
    ? "Write your work, or give up."
    : undefined;
}

export interface StoredProblem {
  readonly id: string;
  readonly mode: LearningProblemMode;
  readonly statement: string;
  readonly parts: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<LearningProblemTarget>;
  readonly hintCount: number;
  readonly retestOf: string | null;
  readonly workspace: LearningProblemWorkspace | null;
}

const MESSAGE_OUTPUT_CHARS = 16_000;

const describeCheck = (command: string, run: LearningCheckRun) => {
  const ending = run.timedOut
    ? `timed out after ${LEARNING_CHECK_TIMEOUT_SECONDS} s`
    : run.exitCode === null
      ? "could not start"
      : `exited with code ${run.exitCode}`;
  const output = run.output.trimEnd();
  if (output.length === 0) return [`Check \`${command}\` ${ending}, with no output.`];
  const shown = output.length > MESSAGE_OUTPUT_CHARS ? output.slice(-MESSAGE_OUTPUT_CHARS) : output;
  const cut = run.truncated || shown.length < output.length;
  const longestTicks = Math.max(0, ...(shown.match(/`+/g) ?? []).map((ticks) => ticks.length));
  const fence = "`".repeat(Math.max(3, longestTicks + 1));
  return [
    `Check \`${command}\` ${ending}. Output${cut ? " (cut to fit)" : ""}:`,
    fence,
    shown,
    fence,
  ];
};

/** The message that hands the learner's work on a problem back to the tutor as their next turn. */
export function formatSolutionMessage(
  problem: StoredProblem,
  attempt: LearningProblemAttempt,
  hintsUsed: number,
  check?: LearningCheckRun,
): string {
  const lines = [
    learningSolutionMessageHeader(problem.id),
    `Problem (${problem.mode}): ${problem.statement}`,
    `Targets: ${problem.targets
      .map((target) =>
        target.propositionId === null ? target.name : `${target.name} (${target.propositionId})`,
      )
      .join("; ")}`,
  ];
  if (problem.retestOf !== null) lines.push(`Retest of: ${problem.retestOf}`);
  const work = attempt.text?.trim();
  const { workspace } = problem;
  if (problem.parts.length > 0) {
    const answers = problem.parts.map((_, index) => attempt.answers?.[index]?.trim() ?? "");
    const answered = answers.some((answer) => answer.length > 0);
    if (attempt.gaveUp)
      lines.push(
        answered ? "They gave up. Their answers so far:" : "They gave up without an attempt.",
      );
    else lines.push("Their answer to each part:");
    if (answered)
      problem.parts.forEach((part, index) =>
        lines.push(`${index + 1}. ${part}: ${answers[index] || "(left blank)"}`),
      );
  } else if (attempt.gaveUp) {
    lines.push(
      work
        ? `They gave up. Their work so far: ${work}`
        : workspace !== null
          ? "They gave up. Their code so far is in the practice folder."
          : "They gave up without an attempt.",
    );
  } else if (work || workspace === null) {
    lines.push(`Their work: ${work ?? ""}`);
  }
  if (workspace !== null) {
    lines.push(
      `Practice folder: ${workspace.folder}/ (starter files: ${workspace.files.join(", ")}). Read their files there before you judge it, and do not change them.`,
    );
    if (workspace.checkCommand !== null && check !== undefined)
      lines.push(...describeCheck(workspace.checkCommand, check));
  }
  lines.push(`Hints used: ${hintsUsed} of ${problem.hintCount}`);
  lines.push(
    problem.parts.length > 0
      ? "Judge each part against your model solution, then call conclude_problem with a verdict that gives each part its own line."
      : "Judge it against your model solution, then call conclude_problem.",
  );
  return lines.join("\n");
}

/**
 * Applies outline changes in order. An op whose topic is gone is skipped with a reason, so a
 * proposal accepted after the learner edited the outline still applies what it can.
 */
export function applyOutlineOps(
  topics: ReadonlyArray<LearningOutlineTopic>,
  ops: ReadonlyArray<LearningOutlineOp>,
  newTopicId: () => string,
): {
  readonly topics: ReadonlyArray<LearningOutlineTopic>;
  readonly skipped: ReadonlyArray<string>;
} {
  const next = [...topics];
  const skipped: Array<string> = [];
  // Adds placed after the same topic go in the order given, each after the last one added there.
  const lastAddedAfter = new Map<string | null, string>();
  const indexOf = (id: string) => next.findIndex((topic) => topic.id === id);
  const insertAt = (after: string | null | undefined) =>
    after === undefined ? next.length : after === null ? 0 : indexOf(after) + 1;
  for (const op of ops) {
    if (op.type === "add") {
      if (next.length >= LEARNING_MAX_OUTLINE_TOPICS) {
        skipped.push(
          `add "${op.title}": an outline holds at most ${LEARNING_MAX_OUTLINE_TOPICS} topics.`,
        );
        continue;
      }
      if (typeof op.after === "string" && indexOf(op.after) === -1) {
        skipped.push(`add "${op.title}": no topic "${op.after}" to place it after.`);
        continue;
      }
      const id = newTopicId();
      const anchor =
        op.after === undefined ? undefined : (lastAddedAfter.get(op.after) ?? op.after);
      next.splice(insertAt(anchor), 0, {
        id,
        title: op.title.trim(),
        ...(op.summary?.trim() ? { summary: op.summary.trim() } : {}),
        status: "todo",
      });
      if (op.after !== undefined) lastAddedAfter.set(op.after, id);
      continue;
    }
    const index = indexOf(op.topicId);
    if (index === -1) {
      skipped.push(`${op.type} "${op.topicId}": no topic with that id.`);
      continue;
    }
    const topic = next[index]!;
    switch (op.type) {
      case "rename": {
        const summary = op.summary === undefined ? topic.summary : op.summary.trim();
        const { summary: _previous, ...rest } = topic;
        next[index] = { ...rest, title: op.title.trim(), ...(summary ? { summary } : {}) };
        break;
      }
      case "setStatus":
        next[index] = { ...topic, status: op.status };
        break;
      case "remove":
        next.splice(index, 1);
        break;
      case "move": {
        if (op.after === op.topicId || (op.after !== null && indexOf(op.after) === -1)) {
          skipped.push(`move "${op.topicId}": no other topic "${op.after}" to place it after.`);
          break;
        }
        next.splice(index, 1);
        next.splice(insertAt(op.after), 0, topic);
        break;
      }
    }
  }
  return { topics: next, skipped };
}
