import { describe, expect, it } from "@effect/vitest";

import type { Persona } from "./cases.ts";
import {
  isDone,
  judgeVerdict,
  learnerReply,
  partAnswers,
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

  it("needs an outline of several topics after measuring, with no plan or card after it", () => {
    const check = { type: "outlineEndsSetup" as const };
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
    expect(ruleVerdict(check, [{ user: "a", events: [measured, planned, adds(5)] }])?.pass).toBe(
      false,
    );
    expect(
      ruleVerdict(check, [{ user: "a", events: [measured, adds(5), measure("q-1")] }])?.pass,
    ).toBe(false);
    expect(ruleVerdict(check, [{ user: "a", events: [measure("q-1")] }])?.inconclusive).toBe(true);
  });

  it("needs levelled strands in short phrases", () => {
    const check = { type: "glanceableStartingPoint" as const };
    const verdict = (strand: Record<string, unknown>) =>
      ruleVerdict(check, [
        { user: "a", events: [call("finish_measuring", { goal: "g", strands: [strand] })] },
      ]);
    expect(verdict({ name: "Vectors", level: "solid", solid: "Adding and scaling" })?.pass).toBe(
      true,
    );
    expect(verdict({ name: "Vectors", solid: "Adding", breaksAt: "Spans" })?.reason).toContain(
      "no level",
    );
    expect(
      verdict({ name: "Vectors", level: "solid", solid: "Adding", breaksAt: "Not found" })?.pass,
    ).toBe(true);
    expect(
      verdict({ name: "Spans", level: "new", breaksAt: "word ".repeat(21) })?.reason,
    ).toContain("21 words");
    expect(
      verdict({ name: "Vectors", level: "solid", solid: "Adding", breaksAt: "Spans" })?.reason,
    ).toContain("solid but has a gap");
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

  it("needs a choice card about code with every option on one line", () => {
    const check = { type: "oneLineCodeOptions" as const };
    const asked = (options: ReadonlyArray<string>) => [
      {
        user: "a",
        events: [
          call("ask_question", {
            purpose: "check",
            format: "choice",
            question: "What type does `first` return?",
            options,
          }),
        ],
      },
    ];
    expect(ruleVerdict(check, [{ user: "a", events: [measure("q-1")] }])?.inconclusive).toBe(true);
    expect(ruleVerdict(check, asked(["`string`", "`T`"]))?.pass).toBe(true);
    expect(ruleVerdict(check, asked(["```ts\nconst a = 1;\n```", "`T`"]))?.pass).toBe(false);
  });

  it("needs a reply to the answer before the judge reads a card turn", () => {
    const check = { type: "quietAroundCard" as const };
    const say = (text: string) => ({ kind: "text", text }) as const;
    const after = (...events: Turn["events"]) => [
      { user: "hi", events: [measure("q-1")] },
      { user: "answer", events },
    ];
    // The app shows the card last, so text on either side of the call counts as the reply.
    expect(ruleVerdict(check, after(measure("q-2"), say("Right: f(3) is 6.")))).toBeUndefined();
    expect(ruleVerdict(check, after(measure("q-2")))?.reason).toContain("without replying");
    // The first card of a session answers nothing.
    expect(ruleVerdict(check, [{ user: "hi", events: [measure("q-1")] }])?.inconclusive).toBe(true);
    const reply = { user: "answer", events: [say("Yes."), measure("q-2")] };
    expect(isDone(check, [...after(say("Yes."), measure("q-2")), reply])).toBe(false);
    expect(isDone(check, [...after(say("Yes."), measure("q-2")), reply, reply])).toBe(true);
    const verdict = (flags: string) => judgeVerdict(check, `{${flags}, "reason": "x"}`).pass;
    expect(
      verdict('"pointsAtCard": false, "tellsToAnswer": false, "restatesQuestion": false'),
    ).toBe(true);
    expect(verdict('"pointsAtCard": false, "tellsToAnswer": true, "restatesQuestion": false')).toBe(
      false,
    );
  });
});

describe("practice runtimes", () => {
  const posed = (checkCommand: string) => call("pose_problem", { workspace: { checkCommand } });
  const refused = {
    ...posed("go test ./..."),
    result: { message: "`go` is not installed on the learner's computer." },
    isError: true,
  };

  it("needs an explanation or a brought language after a missing program", () => {
    const check = { type: "recoversFromMissingProgram" as const };
    const after = (...events: Turn["events"]) => [
      { user: "practice", events: [refused, ...events] },
    ];
    expect(ruleVerdict(check, after({ kind: "text", text: "Install Go from go.dev." }))?.pass).toBe(
      true,
    );
    expect(ruleVerdict(check, after(posed("node --test")))?.pass).toBe(true);
    expect(ruleVerdict(check, after(refused))?.pass).toBe(false);
    expect(ruleVerdict(check, after(call("pose_problem", { statement: "x" })))?.pass).toBe(false);
    expect(isDone(check, after())).toBe(true);
    // Another refusal, such as a draft the server rejects, is not this one.
    const invalid = { ...posed("go test"), result: { message: "hints must be 1 to 3." } };
    const other = [{ user: "practice", events: [{ ...invalid, isError: true }] }];
    expect(ruleVerdict(check, other)?.inconclusive).toBe(true);
    expect(isDone(check, other)).toBe(false);
  });

  it("needs a python3 or node check posed with no talk of installing", () => {
    const check = { type: "posesWithBroughtRuntime" as const };
    const turn = (...events: Turn["events"]) => [{ user: "practice", events }];
    expect(ruleVerdict(check, turn(posed("python3 -m unittest")))?.pass).toBe(true);
    expect(ruleVerdict(check, turn(posed("go test")))?.pass).toBe(false);
    expect(
      ruleVerdict(
        check,
        turn({ kind: "text", text: "Is Python installed?" }, posed("python3 -m unittest")),
      )?.pass,
    ).toBe(false);
  });
});

describe("answer fields", () => {
  const posed = (parts?: ReadonlyArray<string>) => [
    {
      user: "practice",
      events: [
        call("pose_problem", {
          mode: "compose",
          statement: "Give each type.",
          targets: ["p-ts-let-const"],
          modelSolution: "1. `number`\n2. `3`",
          hints: ["Which one can be reassigned?"],
          ...(parts ? { parts } : {}),
        }),
      ],
    },
  ];

  it("passes parts by rule and leaves a single box to the judge", () => {
    const check = { type: "oneFieldPerAnswer" as const };
    expect(ruleVerdict(check, posed(["Type of `a`", "Type of `b`"]))?.pass).toBe(true);
    expect(ruleVerdict(check, posed(["Type of `a`"]))?.pass).toBe(false);
    expect(ruleVerdict(check, posed())).toBeUndefined();
    expect(ruleVerdict(check, [{ user: "hi", events: [measure("q-1")] }])?.inconclusive).toBe(true);
    expect(judgeVerdict(check, '{"severalAnswers": true, "reason": "a to e"}').pass).toBe(false);
    expect(judgeVerdict(check, '{"severalAnswers": false, "reason": "one"}').pass).toBe(true);
  });

  it("answers each part from the matching item of the tutor's solution", () => {
    const solution = "1. `number`. A `let` widens.\n2. `3`, the literal type.";
    expect(partAnswers(["Type of `a`", "Type of `b`"], solution)).toEqual([
      "`number`.",
      "`3`, the literal type.",
    ]);
    expect(partAnswers(["a", "b"], "Both are numbers.")).toEqual(["Both are numbers.", ""]);
  });

  it("fails a verdict that runs on as one block", () => {
    const check = { type: "verdictInShortPieces" as const };
    const concluded = (verdict: string) => [
      { user: "work", events: [call("conclude_problem", { verdict })] },
    ];
    expect(ruleVerdict(check, concluded("1. Right.\n2. Wrong: `let` widens."))?.pass).toBe(true);
    expect(ruleVerdict(check, concluded("Parts 1 to 4 are right. ".repeat(20)))?.pass).toBe(false);
    expect(ruleVerdict(check, posed())?.inconclusive).toBe(true);
  });

  it("fails one piece of work split into parts", () => {
    const check = { type: "noParts" as const };
    expect(ruleVerdict(check, posed())?.pass).toBe(true);
    expect(ruleVerdict(check, posed(["State the rule", "Name each term"]))?.pass).toBe(false);
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
