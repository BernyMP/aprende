import { describe, expect, it } from "@effect/vitest";

import type { Persona } from "./cases.ts";
import {
  isDone,
  judgeVerdict,
  learnerReply,
  ruleVerdict,
  teachingWindow,
  type Turn,
  untilNamed,
} from "./grade.ts";

const persona: Persona = {
  opening: "Teach me recursion.",
  goal: "Trace a recursive function.",
  choose: ["weekly"],
  knowsFirst: 1,
  problems: "giveUp",
  reply: "Go on.",
};

const call = (name: string, input: Record<string, unknown>, result: Record<string, unknown> = {}) =>
  ({ kind: "call", name, input, result, isError: false }) as const;

const measure = (id: string) =>
  call(
    "ask_question",
    {
      purpose: "measure",
      format: "choice",
      question: "What does f(3) return?",
      options: ["6", "3"],
      correctOptions: [0],
    },
    { questionId: id },
  );

describe("learnerReply", () => {
  it("answers measure questions right until it reaches what it does not know", () => {
    const first: Array<Turn> = [{ user: "hi", events: [measure("q-1")] }];
    expect(learnerReply(persona, first)).toContain("Result: correct.");
    const second = [...first, { user: "answer", events: [measure("q-2")] }];
    expect(learnerReply(persona, second)).toContain("Their answer: I don't know.");
  });

  it("picks a goal option by keyword and replies in words when there is no card", () => {
    const goal = call(
      "ask_question",
      {
        purpose: "goal",
        format: "choice",
        question: "How often will you study?",
        options: ["Daily", "Weekly"],
      },
      { questionId: "q-1" },
    );
    expect(learnerReply(persona, [{ user: "hi", events: [goal] }])).toContain("Weekly");
    expect(learnerReply(persona, [{ user: "hi", events: [{ kind: "text", text: "Hi" }] }])).toBe(
      "Go on.",
    );
  });

  it("sends a scripted chat message instead of answering", () => {
    const chatty = { ...persona, chat: { 1: "Just tell me." } };
    expect(learnerReply(chatty, [{ user: "hi", events: [measure("q-1")] }])).toBe("Just tell me.");
  });
});

describe("teachingWindow", () => {
  it("starts after set_plan and ends at the first check question or problem", () => {
    const turns: Array<Turn> = [
      { user: "a", events: [measure("q-1"), call("set_plan", {}), { kind: "text", text: "Plan" }] },
      {
        user: "Sounds good",
        events: [
          { kind: "text", text: "Worked example" },
          call("pose_problem", { statement: "Trace f(2)" }),
          { kind: "text", text: "After" },
        ],
      },
    ];
    const window = teachingWindow(turns);
    expect(window.complete).toBe(true);
    expect(window.events.map((event) => event.kind)).toEqual(["text", "learner", "text", "call"]);
    expect(isDone({ type: "approach", expect: "worked-example" }, turns)).toBe(true);
  });

  it("is incomplete before any plan", () => {
    expect(teachingWindow([{ user: "a", events: [measure("q-1")] }]).complete).toBe(false);
  });
});

describe("ruleVerdict", () => {
  it("needs a recall problem naming a due proposition for a review", () => {
    const check = { type: "reviewTargets" as const, ids: ["p-1"] };
    const posed = (mode: string, targets: Array<string>) => [
      { user: "review", events: [call("pose_problem", { mode, targets })] },
    ];
    expect(ruleVerdict(check, posed("recall", ["p-1"]))?.pass).toBe(true);
    expect(ruleVerdict(check, posed("compose", ["p-1"]))?.pass).toBe(false);
    expect(ruleVerdict(check, posed("recall", ["Bayes"]))?.pass).toBe(false);
  });

  it("needs an outline of several topics suggested after measuring", () => {
    const check = { type: "outlineAfterMeasuring" as const };
    const adds = (count: number) =>
      call("propose_outline", {
        ops: Array.from({ length: count }, (_, index) => ({ type: "add", title: `t${index}` })),
        reason: "x",
      });
    const measured = call("finish_measuring", { goal: "g", strands: [] });
    expect(ruleVerdict(check, [{ user: "a", events: [measured, adds(5)] }])?.pass).toBe(true);
    expect(ruleVerdict(check, [{ user: "a", events: [adds(5), measured] }])?.pass).toBe(false);
    expect(ruleVerdict(check, [{ user: "a", events: [measured, adds(2)] }])?.pass).toBe(false);
    const planned = call("set_plan", { nodes: [], edges: [] });
    expect(ruleVerdict(check, [{ user: "a", events: [planned, adds(5)] }])?.pass).toBe(true);
    expect(ruleVerdict(check, [{ user: "a", events: [measure("q-1")] }])?.inconclusive).toBe(true);
  });

  it("needs a goal question before a short notebook name, then leaves the rest to the judge", () => {
    const check = { type: "guidedNotebookStart" as const };
    const goal = call("ask_question", { purpose: "goal", question: "What do you want to learn?" });
    const name = (value: string) => call("name_notebook", { name: value });
    expect(ruleVerdict(check, [{ user: "a", events: [goal] }])?.pass).toBe(false);
    expect(ruleVerdict(check, [{ user: "a", events: [name("Azure")] }])?.pass).toBe(false);
    expect(
      ruleVerdict(check, [{ user: "a", events: [goal, name("Azure fundamentals for my new job")] }])
        ?.pass,
    ).toBe(false);
    expect(ruleVerdict(check, [{ user: "a", events: [goal, name("Azure AZ-900")] }])).toBe(
      undefined,
    );
  });

  it("fails a saved profile that is asked for again", () => {
    const asked = call("ask_question", {
      purpose: "goal",
      question: "How often will you come back to study?",
    });
    expect(
      ruleVerdict({ type: "noProfileQuestions" }, [{ user: "a", events: [asked] }])?.pass,
    ).toBe(false);
    expect(
      ruleVerdict({ type: "noProfileQuestions" }, [{ user: "a", events: [measure("q-1")] }])?.pass,
    ).toBe(true);
  });

  it("needs both profile fields saved", () => {
    const saved = (input: Record<string, unknown>) => [
      { user: "a", events: [call("set_profile", input)] },
    ];
    const check = {
      type: "collectsProfile" as const,
      fields: ["goalKind", "returnCadence"] as const,
    };
    expect(ruleVerdict(check, saved({ goalKind: "exam" }))?.pass).toBe(false);
    const separately = [
      { user: "a", events: [call("set_profile", { returnCadence: "daily" })] },
      { user: "b", events: [call("set_profile", { goalKind: "exam" })] },
    ];
    expect(ruleVerdict(check, separately)?.pass).toBe(true);
    expect(ruleVerdict(check, saved({ goalKind: "exam", returnCadence: "daily" }))?.pass).toBe(
      true,
    );
  });
});

describe("untilNamed", () => {
  it("stops at the naming call, even mid-turn", () => {
    const goal = call("ask_question", { purpose: "goal", question: "What do you want to learn?" });
    const events = untilNamed([
      { user: "start", events: [goal] },
      { user: "Azure", events: [call("name_notebook", { name: "Azure" }), measure("q-2")] },
    ]);
    expect(events.map((event) => event.kind)).toEqual(["learner", "call", "learner"]);
  });
});

describe("judgeVerdict", () => {
  it("passes problem first only when no worked example came first", () => {
    const check = { type: "approach" as const, expect: "problem-first" as const };
    expect(
      judgeVerdict(check, '{"workedExampleFirst": false, "problemFirst": true, "reason": "x"}')
        .pass,
    ).toBe(true);
    expect(
      judgeVerdict(check, '{"workedExampleFirst": true, "problemFirst": true, "reason": "x"}').pass,
    ).toBe(false);
    expect(judgeVerdict(check, "no json").inconclusive).toBe(true);
  });
});
