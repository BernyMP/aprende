import { describe, expect, it } from "@effect/vitest";
import {
  learningAnswerMessageQuestionId,
  learningSolutionMessageProblemId,
} from "@aprende/contracts";

import {
  answerProblem,
  formatAnswerMessage,
  formatSolutionMessage,
  gradeAnswer,
  planProblem,
  problemDraftProblem,
  questionDraftProblem,
  shuffleOptions,
  type StoredQuestion,
} from "./learningLogic.ts";

const node = (id: string) => ({ id, title: id });

describe("planProblem", () => {
  it.each([
    [
      "accepts a DAG",
      [node("a"), node("b"), node("c")],
      [
        ["a", "b"],
        ["a", "c"],
        ["b", "c"],
      ],
      undefined,
    ],
    [
      "rejects a cycle",
      [node("a"), node("b")],
      [
        ["a", "b"],
        ["b", "a"],
      ],
      "cycle",
    ],
    ["rejects a self edge", [node("a")], [["a", "a"]], "itself"],
    ["rejects an unknown node", [node("a")], [["a", "z"]], "does not exist"],
    ["rejects duplicate ids", [node("a"), node("a")], [], "twice"],
    ["rejects an empty plan", [], [], "no nodes"],
  ] as const)("%s", (_name, nodes, edges, expected) => {
    const problem = planProblem(
      nodes,
      edges.map(([from, to]) => ({ from, to })),
    );
    if (expected === undefined) expect(problem).toBeUndefined();
    else expect(problem).toContain(expected);
  });
});

describe("questionDraftProblem", () => {
  const base = {
    purpose: "check" as const,
    format: "choice" as const,
    question: "Which is true?",
    options: ["A", "B"],
    correctOptions: [0],
    explanation: "Because.",
    planNodeId: "n1",
  };
  const plan = new Set(["n1"]);

  it.each([
    ["accepts a valid check", base, plan, undefined],
    ["needs a committed answer when graded", { ...base, correctOptions: [] }, plan, "committed"],
    ["needs an explanation when graded", { ...base, explanation: undefined }, plan, "explanation"],
    ["refuses grading a goal question", { ...base, purpose: "goal" as const }, plan, "not graded"],
    [
      "needs the plan node once a plan exists",
      { ...base, planNodeId: undefined },
      plan,
      "planNodeId",
    ],
    ["refuses an unknown plan node", { ...base, planNodeId: "zz" }, plan, "not a node"],
    ["refuses teaching before a plan exists", { ...base, planNodeId: undefined }, null, "set_plan"],
    [
      "measures before a plan exists",
      { ...base, purpose: "measure" as const, planNodeId: undefined },
      null,
      undefined,
    ],
    [
      "needs allowMultiple for several answers",
      { ...base, correctOptions: [0, 1] },
      plan,
      "allowMultiple",
    ],
    ["refuses duplicate options", { ...base, options: ["A", "A"] }, plan, "same"],
    [
      "needs a model answer for graded recall",
      { ...base, format: "recall" as const, options: undefined, correctOptions: undefined },
      plan,
      "modelAnswer",
    ],
  ] as const)("%s", (_name, draft, nodes, expected) => {
    const problem = questionDraftProblem(draft, nodes);
    if (expected === undefined) expect(problem).toBeUndefined();
    else expect(problem).toContain(expected);
  });
});

describe("grading", () => {
  const question = { format: "choice" as const, correctOptions: [0, 2] };

  it("needs exactly the correct set", () => {
    expect(gradeAnswer(question, [2, 0], false)).toBe(true);
    expect(gradeAnswer(question, [0], false)).toBe(false);
    expect(gradeAnswer(question, [0, 1, 2], false)).toBe(false);
  });

  it("counts don't know as wrong and leaves ungraded questions ungraded", () => {
    expect(gradeAnswer(question, [], true)).toBe(false);
    expect(gradeAnswer({ format: "choice", correctOptions: [] }, [1], false)).toBeNull();
    expect(gradeAnswer({ format: "recall", correctOptions: [] }, [], false)).toBeNull();
  });

  it("refuses answers that pick nothing or too much", () => {
    const single = { format: "choice" as const, options: ["A", "B"], allowMultiple: false };
    expect(answerProblem(single, { selectedOptions: [], dontKnow: false })).toBeDefined();
    expect(answerProblem(single, { selectedOptions: [0, 1], dontKnow: false })).toBeDefined();
    expect(answerProblem(single, { selectedOptions: [5], dontKnow: false })).toBeDefined();
    expect(answerProblem(single, { selectedOptions: [], dontKnow: true })).toBeUndefined();
    const recall = { format: "recall" as const, options: [], allowMultiple: false };
    expect(
      answerProblem(recall, { selectedOptions: [], text: "  ", dontKnow: false }),
    ).toBeDefined();
  });
});

describe("shuffleOptions", () => {
  const options = ["alpha", "beta", "gamma", "delta", "epsilon"];

  it("keeps each correct index pointing at the same option, deterministically per seed", () => {
    const first = shuffleOptions(options, [1, 3], "q-seed");
    expect(shuffleOptions(options, [1, 3], "q-seed")).toEqual(first);
    expect(first.options.toSorted()).toEqual(options.toSorted());
    expect(first.correctOptions.map((index) => first.options[index]).toSorted()).toEqual([
      "beta",
      "delta",
    ]);
  });
});

describe("formatAnswerMessage", () => {
  const question: StoredQuestion = {
    id: "q-123",
    purpose: "check",
    format: "choice",
    prompt: "Which is true?",
    options: ["One", "Two"],
    correctOptions: [1],
    allowMultiple: false,
    modelAnswer: null,
    explanation: "Two is true.",
  };

  it("names the question so the client can recognize the message", () => {
    const text = formatAnswerMessage(question, {
      selectedOptions: [0],
      dontKnow: false,
      confidence: 80,
      thinking: "  I guessed  ",
      correct: false,
      answeredAt: "2026-11-04T00:00:00.000Z",
    });
    expect(learningAnswerMessageQuestionId(text)).toBe("q-123");
    expect(text).toContain("Their answer: A) One");
    expect(text).toContain("Result: incorrect. Correct: B) Two");
    expect(text).toContain("Confidence: 80%");
    expect(text).toContain("Their thinking: I guessed");
    expect(learningAnswerMessageQuestionId("Hello [Answer to question q-1]")).toBeNull();
  });
});

describe("problemDraftProblem", () => {
  const base = {
    mode: "compose" as const,
    statement: "Order these tasks.",
    targets: ["p-edges"],
    modelSolution: "A, then B, then C.",
    hints: ["Start with what has no prerequisites."],
  };

  it.each([
    ["accepts a valid problem", base, undefined],
    ["needs a model solution", { ...base, modelSolution: "  " }, "modelSolution"],
    ["needs a hint", { ...base, hints: [] }, "1 to 3"],
    ["takes at most three hints", { ...base, hints: ["a", "b", "c", "d"] }, "1 to 3"],
    ["refuses an empty hint", { ...base, hints: ["a", " "] }, "empty"],
    ["needs a target", { ...base, targets: [] }, "target"],
  ] as const)("%s", (_name, draft, expected) => {
    const problem = problemDraftProblem(draft);
    if (expected === undefined) expect(problem).toBeUndefined();
    else expect(problem).toContain(expected);
  });
});

describe("formatSolutionMessage", () => {
  const problem = {
    id: "prob-1",
    mode: "discriminate" as const,
    statement: "Which graph is a valid plan?",
    targets: [
      { name: "Edges", propositionId: "p-1" },
      { name: "cycles", propositionId: null },
    ],
    hintCount: 3,
    retestOf: "prob-0",
  };

  it("names the problem and carries the work, hints and confidence", () => {
    const text = formatSolutionMessage(
      problem,
      {
        text: "The second one.",
        gaveUp: false,
        confidence: 40,
        thinking: " no cycle ",
        submittedAt: "2026-11-04T00:00:00.000Z",
      },
      2,
    );
    expect(learningSolutionMessageProblemId(text)).toBe("prob-1");
    expect(learningAnswerMessageQuestionId(text)).toBeNull();
    expect(text).toContain("Problem (discriminate): Which graph is a valid plan?");
    expect(text).toContain("Targets: Edges (p-1); cycles");
    expect(text).toContain("Retest of: prob-0");
    expect(text).toContain("Their work: The second one.");
    expect(text).toContain("Hints used: 2 of 3");
    expect(text).toContain("Confidence: 40%");
    expect(text).toContain("Their thinking: no cycle");
  });

  it("says when they gave up", () => {
    const text = formatSolutionMessage(
      problem,
      { gaveUp: true, submittedAt: "2026-11-04T00:00:00.000Z" },
      0,
    );
    expect(text).toContain("They gave up without an attempt.");
    expect(text).not.toContain("Confidence");
  });
});
