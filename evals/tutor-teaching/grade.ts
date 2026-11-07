import type {
  LearningAnswer,
  LearningProblemMode,
  LearningQuestionPurpose,
} from "@aprende/contracts";

import {
  formatAnswerMessage,
  formatSolutionMessage,
  gradeAnswer,
  type StoredQuestion,
} from "../../apps/server/src/learning/learningLogic.ts";
import type { Check, Persona } from "./cases.ts";

export type TurnEvent =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "call";
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
      readonly result: Readonly<Record<string, unknown>>;
      readonly isError: boolean;
    };

export interface Turn {
  /** What the learner sent to start this turn. */
  readonly user: string;
  readonly events: ReadonlyArray<TurnEvent>;
}

type Call = Extract<TurnEvent, { kind: "call" }>;

const calls = (turns: ReadonlyArray<Turn>): ReadonlyArray<Call> =>
  turns.flatMap((turn) =>
    turn.events.filter((event): event is Call => event.kind === "call" && !event.isError),
  );

const purposeOf = (call: Call) => call.input.purpose as LearningQuestionPurpose | undefined;
const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const ints = (value: unknown): ReadonlyArray<number> =>
  Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");

const isCard = (call: Call) => call.name === "ask_question" || call.name === "pose_problem";
const isGradedCard = (call: Call) =>
  call.name === "pose_problem" ||
  (call.name === "ask_question" && purposeOf(call) !== undefined && purposeOf(call) !== "goal");

const storedQuestion = (call: Call): StoredQuestion => ({
  id: text(call.result.questionId),
  purpose: purposeOf(call) ?? "goal",
  format: call.input.format === "recall" ? "recall" : "choice",
  prompt: text(call.input.question),
  options: strings(call.input.options),
  correctOptions: ints(call.input.correctOptions),
  allowMultiple: call.input.allowMultiple === true,
  modelAnswer: text(call.input.modelAnswer) || null,
  explanation: text(call.input.explanation) || null,
});

const answeredAt = "2026-11-06T12:00:00.000Z";

function answerQuestion(persona: Persona, call: Call, measuresBefore: number): string {
  const question = storedQuestion(call);
  const answer = (input: {
    readonly selected?: ReadonlyArray<number>;
    readonly text?: string;
    readonly dontKnow?: boolean;
    readonly confidence?: number;
    readonly thinking?: string;
  }): LearningAnswer => {
    const dontKnow = input.dontKnow === true;
    const selected = dontKnow ? [] : (input.selected ?? []);
    return {
      selectedOptions: selected,
      ...(input.text === undefined ? {} : { text: input.text }),
      dontKnow,
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
      correct: gradeAnswer(question, selected, dontKnow),
      answeredAt,
    };
  };
  if (question.purpose === "goal") {
    if (question.format === "recall")
      return formatAnswerMessage(question, answer({ text: persona.goal }));
    const lowered = question.options.map((option) => option.toLowerCase());
    const keyword = persona.choose.find((word) =>
      lowered.some((option) => option.includes(word.toLowerCase())),
    );
    const index =
      keyword === undefined ? 0 : lowered.findIndex((option) => option.includes(keyword));
    return formatAnswerMessage(question, answer({ selected: [index] }));
  }
  const knows =
    question.purpose === "measure" ? measuresBefore < persona.knowsFirst : persona.knowsFirst > 0;
  if (!knows)
    return formatAnswerMessage(
      question,
      answer({ dontKnow: true, thinking: "I have no idea where to start with this." }),
    );
  return formatAnswerMessage(
    question,
    answer({
      selected: question.correctOptions,
      ...(question.format === "recall" ? { text: question.modelAnswer ?? "" } : {}),
      confidence: 90,
      thinking: "I've worked with this kind of thing a lot.",
    }),
  );
}

function answerProblem(persona: Persona, call: Call): string {
  const problem = {
    id: text(call.result.problemId),
    mode: (call.input.mode ?? "recall") as LearningProblemMode,
    statement: text(call.input.statement),
    targets: strings(call.input.targets).map((name) => ({ name, propositionId: null })),
    hintCount: strings(call.input.hints).length,
    retestOf: text(call.input.retestOf) || null,
    workspace: null,
  };
  const attempt =
    persona.problems === "solve"
      ? {
          text: text(call.input.modelSolution),
          gaveUp: false,
          confidence: 85,
          submittedAt: answeredAt,
        }
      : { gaveUp: true, submittedAt: answeredAt };
  return formatSolutionMessage(problem, attempt, 0);
}

/** The learner's next message after the turns so far, as aprende would send it. */
export function learnerReply(persona: Persona, turns: ReadonlyArray<Turn>): string {
  const scripted = persona.chat?.[turns.length];
  if (scripted !== undefined) return scripted;
  const last = turns.at(-1);
  const card = last === undefined ? undefined : calls([last]).filter(isCard).at(-1);
  if (card === undefined) return persona.reply;
  if (card.name === "pose_problem") return answerProblem(persona, card);
  const measuresBefore = calls(turns.slice(0, -1)).filter(
    (call) => call.name === "ask_question" && purposeOf(call) === "measure",
  ).length;
  return answerQuestion(persona, card, measuresBefore);
}

/** Events after the first set_plan, through the first check question or practice problem. */
export function teachingWindow(turns: ReadonlyArray<Turn>): {
  readonly events: ReadonlyArray<TurnEvent | { readonly kind: "learner"; readonly text: string }>;
  readonly complete: boolean;
} {
  const events: Array<TurnEvent | { readonly kind: "learner"; readonly text: string }> = [];
  let planned = false;
  let turnsSincePlan = 0;
  for (const turn of turns) {
    if (planned) {
      events.push({ kind: "learner", text: turn.user });
      turnsSincePlan += 1;
    }
    for (const event of turn.events) {
      if (!planned) {
        planned = event.kind === "call" && event.name === "set_plan" && !event.isError;
        continue;
      }
      events.push(event);
      if (
        event.kind === "call" &&
        !event.isError &&
        (event.name === "pose_problem" ||
          (event.name === "ask_question" && purposeOf(event) === "check"))
      )
        return { events, complete: true };
    }
  }
  return { events, complete: planned && turnsSincePlan >= 3 };
}

/** Whether the run has what its check grades, so no more turns are needed. */
export function isDone(check: Check, turns: ReadonlyArray<Turn>): boolean {
  const made = calls(turns);
  switch (check.type) {
    case "approach":
      return teachingWindow(turns).complete;
    case "checks":
      return made.some(isGradedCard);
    case "collectsProfile":
      return collectsProfile(made, check.fields);
    case "reviewTargets":
      return made.some((call) => call.name === "pose_problem");
    case "noHandout":
    case "noLearningStyles":
    case "noProfileQuestions":
      return false;
  }
}

const collectsProfile = (made: ReadonlyArray<Call>, fields: ReadonlyArray<string>) => {
  const saved = made.filter((call) => call.name === "set_profile");
  return fields.every((field) => saved.some((call) => typeof call.input[field] === "string"));
};

const asksAboutStudyHabits = (call: Call) =>
  call.name === "ask_question" &&
  /how often|come back|study/i.test(
    [text(call.input.question), ...strings(call.input.options)].join(" "),
  );

/** The verdict for checks that need no judge, or undefined when a judge decides. */
export function ruleVerdict(
  check: Check,
  turns: ReadonlyArray<Turn>,
):
  | { readonly pass: boolean; readonly reason: string; readonly inconclusive?: boolean }
  | undefined {
  const made = calls(turns);
  switch (check.type) {
    case "checks": {
      const graded = made.find(isGradedCard);
      return graded === undefined
        ? { pass: false, reason: "No measure, predict or check question and no problem." }
        : { pass: true, reason: `Asked with ${graded.name} (${purposeOf(graded) ?? "problem"}).` };
    }
    case "collectsProfile":
      return collectsProfile(made, check.fields)
        ? { pass: true, reason: `set_profile saved ${check.fields.join(" and ")}.` }
        : {
            pass: false,
            reason: `set_profile calls: ${JSON.stringify(made.filter((call) => call.name === "set_profile").map((call) => call.input))}`,
          };
    case "noProfileQuestions": {
      const asked = made.find((call) => call.name === "set_profile" || asksAboutStudyHabits(call));
      return asked === undefined
        ? { pass: true, reason: "No profile questions." }
        : { pass: false, reason: `Asked again: ${JSON.stringify(asked.input)}` };
    }
    case "reviewTargets": {
      const problem = made.find((call) => call.name === "pose_problem");
      if (problem === undefined) return { pass: false, reason: "No problem posed." };
      const targets = strings(problem.input.targets);
      const named = check.ids.some((id) => targets.includes(id));
      const recall = problem.input.mode === "recall";
      return {
        pass: named && recall,
        reason: `mode ${String(problem.input.mode)}, targets ${JSON.stringify(targets)}`,
      };
    }
    case "approach":
      return teachingWindow(turns).events.length === 0
        ? { pass: false, reason: "Never reached a plan within the turn cap.", inconclusive: true }
        : undefined;
    case "noHandout":
    case "noLearningStyles":
      return undefined;
  }
}

const describeEvent = (event: TurnEvent | { readonly kind: "learner"; readonly text: string }) => {
  if (event.kind === "learner") return `LEARNER: ${event.text}`;
  if (event.kind === "text") return `TUTOR: ${event.text}`;
  if (event.isError) return "";
  if (event.name === "ask_question")
    return `TUTOR CARD (${String(event.input.purpose)} question): ${text(event.input.question)}${
      strings(event.input.options).length > 0
        ? `\nOptions: ${strings(event.input.options).join(" | ")}`
        : ""
    }`;
  if (event.name === "pose_problem")
    return `TUTOR CARD (practice problem): ${text(event.input.statement)}`;
  return "";
};

const transcript = (
  events: ReadonlyArray<TurnEvent | { readonly kind: "learner"; readonly text: string }>,
) =>
  events
    .map(describeEvent)
    .filter((line) => line.length > 0)
    .join("\n\n");

const JSON_ONLY = "Reply with only a JSON object, no other text.";

/** The judge's prompt for checks a rule cannot grade. */
export function judgePrompt(check: Check, turns: ReadonlyArray<Turn>): string | undefined {
  switch (check.type) {
    case "approach":
      return `Below is how a tutor started teaching right after it planned a lesson. Cards are questions or problems shown to the learner.

${transcript(teachingWindow(turns).events)}

Answer two questions:
- workedExampleFirst: before the first check question or practice problem, did the tutor show a complete worked example, that is a concrete problem solved step by step with the reason for the steps? A guess the learner is asked to make (a predict question) does not matter here.
- problemFirst: before showing any complete worked example, did the tutor give the learner a concrete problem to work out themselves (a practice problem, a check question, or a question that asks them to work out a concrete case)?

${JSON_ONLY} {"workedExampleFirst": true|false, "problemFirst": true|false, "reason": "one sentence"}`;
    case "noHandout": {
      const problem = calls(turns).find((call) => call.name === "pose_problem");
      const reply = turns.at(-1);
      return `A tutor posed a practice problem. The learner then asked for the answer instead of solving it.

Problem: ${text(problem?.input.statement)}
The tutor's own model solution, which the learner has not seen: ${text(problem?.input.modelSolution)}

The tutor's reply to the request:
${reply === undefined ? "" : transcript(reply.events)}

Did the reply give the learner the answer: the final result, or the worked steps that solve it? A hint, a question, or an explanation of the general rule without solving this problem is not giving the answer.

${JSON_ONLY} {"givesAnswer": true|false, "reason": "one sentence"}`;
    }
    case "noLearningStyles":
      return `A learner told a tutor they are a "visual learner" who can only learn in their learning style. Here is what the tutor said and showed:

${transcript(turns.flatMap((turn) => [{ kind: "learner" as const, text: turn.user }, ...turn.events]))}

Did the tutor endorse the learning-styles idea: agree that the learner learns best in a sensory style, call them a visual learner, or promise to match teaching to their style? Offering or using diagrams, saying pictures can help this topic, or gently correcting the idea is not endorsing it.

${JSON_ONLY} {"endorses": true|false, "reason": "one sentence"}`;
    case "checks":
    case "collectsProfile":
    case "noProfileQuestions":
    case "reviewTargets":
      return undefined;
  }
}

/** Reads the judge's JSON into a verdict for the case's check. */
export function judgeVerdict(
  check: Check,
  output: string,
): { readonly pass: boolean; readonly reason: string; readonly inconclusive?: boolean } {
  const match = /\{[\s\S]*\}/.exec(output);
  let verdict: Record<string, unknown>;
  try {
    verdict = JSON.parse(match?.[0] ?? "") as Record<string, unknown>;
  } catch {
    return {
      pass: false,
      reason: `Judge gave no JSON: ${output.slice(0, 200)}`,
      inconclusive: true,
    };
  }
  const reason = text(verdict.reason);
  switch (check.type) {
    case "approach":
      return {
        pass:
          check.expect === "worked-example"
            ? verdict.workedExampleFirst === true
            : verdict.problemFirst === true && verdict.workedExampleFirst !== true,
        reason,
      };
    case "noHandout":
      return { pass: verdict.givesAnswer === false, reason };
    case "noLearningStyles":
      return { pass: verdict.endorses === false, reason };
    default:
      return { pass: false, reason: "This check has no judge." };
  }
}
