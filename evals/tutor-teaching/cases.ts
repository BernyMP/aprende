import { NEW_NOTEBOOK_MESSAGE } from "../../apps/web/src/components/learning/notebook.logic.ts";

import {
  type LearnerProfile,
  type LearningDueReviews,
  type LearningKnowledge,
  type LearningOutlineTopic,
  learningSessionStartMessage,
} from "@aprende/contracts";

/** A scripted learner. It answers the tutor's cards the same way every run. */
export interface Persona {
  readonly opening: string;
  /** The answer to recall-format goal cards. */
  readonly goal: string;
  /** Picks a choice goal card's option: the first keyword found in an option wins. */
  readonly choose: ReadonlyArray<string>;
  /** How many measure questions it gets right, confidently, before it says "I don't know". */
  readonly knowsFirst: number;
  /** Practice problems: solve them with the tutor's own solution, or give up. */
  readonly problems: "solve" | "giveUp";
  /** What it says when the tutor ends a turn without a card. */
  readonly reply: string;
  /** Messages typed in the chat instead of answering, by turn number (1 is the opening reply). */
  readonly chat?: Readonly<Record<number, string>>;
}

export type Check =
  /** Graded on the turns after set_plan, up to the first check question or practice problem. */
  | { readonly type: "approach"; readonly expect: "worked-example" | "problem-first" }
  /** A graded card (measure, predict or check) or a practice problem within the run. */
  | { readonly type: "checks" }
  /** The reply to "just tell me the answer" leaves the open problem for the learner. */
  | { readonly type: "noHandout" }
  /** Nothing the tutor says endorses learning styles. */
  | { readonly type: "noLearningStyles" }
  /** set_profile saves these profile fields. */
  | {
      readonly type: "collectsProfile";
      readonly fields: ReadonlyArray<"goalKind" | "returnCadence">;
    }
  /** A saved profile is not asked for again. */
  | { readonly type: "noProfileQuestions" }
  /** A review poses a recall problem naming the due proposition. */
  | { readonly type: "reviewTargets"; readonly ids: ReadonlyArray<string> }
  /** propose_outline drafts several topics, after finish_measuring or set_plan. */
  | { readonly type: "outlineAfterMeasuring" }
  /** No propose_outline call. */
  | { readonly type: "noOutlineProposal" }
  /** A new notebook: one thing per card, no lecture, then name_notebook with a short name. */
  | { readonly type: "guidedNotebookStart" }
  /** No name_notebook call on a notebook that already has a name. */
  | { readonly type: "keepsNotebookName" }
  /** After a problem is refused for a missing program: says what to install, or poses with python3 or node. */
  | { readonly type: "recoversFromMissingProgram" }
  /** A coding problem checked with python3 or node, posed without any talk of installing. */
  | { readonly type: "posesWithBroughtRuntime" };

/** What get_outline returns; cases without one run outside any notebook. */
export interface OutlineMock {
  readonly inNotebook: boolean;
  readonly notebook: string | null;
  readonly topics: ReadonlyArray<LearningOutlineTopic & { readonly lessons: number }>;
  readonly lessonTopicId: string | null;
  readonly pendingProposal: boolean;
  readonly needsName: boolean;
}

export interface TutorCase {
  readonly id: string;
  /** bad reproduces a mistake, guard protects correct behavior, control is ordinary work. */
  readonly kind: "bad" | "guard" | "control";
  readonly source: string;
  readonly experience: string;
  readonly profile: LearnerProfile;
  readonly persona: Persona;
  readonly maxTurns: number;
  readonly mocks?: {
    readonly graph_search?: LearningKnowledge;
    readonly review_due?: LearningDueReviews;
    readonly get_outline?: OutlineMock;
    /** Programs the learner's computer lacks; pose_problem refuses a check that starts with one. */
    readonly missingPrograms?: ReadonlyArray<string>;
  };
  readonly check: Check;
}

const SOURCE =
  "PR adding spaced review, prior-knowledge teaching and the learner profile (issue #2); research brief in its description";
const savedProfile: LearnerProfile = { goalKind: "understanding", returnCadence: "weekly" };

const recursionNovice: Persona = {
  opening:
    "I want to understand recursion in programming. I've never programmed before, so I'm starting from zero.",
  goal: "Understand how a function can call itself and still finish, well enough to trace one by hand.",
  choose: ["understand", "deep", "weekly"],
  knowsFirst: 0,
  problems: "giveUp",
  reply: "Okay, that suits me. Let's go.",
};

const recursionExpert: Persona = {
  opening:
    "I'm a backend engineer with ten years of Python and Go. I use loops, stacks and functions all day, but I never really got recursion beyond the textbook factorial. I want to be able to write recursive solutions to tree problems.",
  goal: "Write recursive functions over trees, like depth and path sums, without looking anything up.",
  choose: ["skill", "use", "weekly"],
  knowsFirst: 4,
  problems: "solve",
  reply: "Sounds good, go ahead.",
};

const NOTEBOOK_SOURCE =
  "PR adding notebooks: an outline per subject the learner owns, with lessons linked to topics";

const eigenLearner: Persona = {
  opening: "I want to understand what eigenvectors are and why they matter.",
  goal: "Understand what an eigenvector is, and find the eigenvectors of a 2 by 2 matrix.",
  choose: ["understand", "deep", "weekly"],
  knowsFirst: 2,
  problems: "solve",
  reply: "Sounds good, let's go.",
};

const NEW_NOTEBOOK_SOURCE =
  "First try of New notebook: a three-part question card with links before any guidance";

const newNotebook: OutlineMock = {
  inNotebook: true,
  notebook: "New notebook",
  topics: [],
  lessonTopicId: null,
  pendingProposal: false,
  needsName: true,
};

const RUNTIMES_SOURCE =
  "PR bringing python3 and node to practice folders and refusing a check whose program is missing";

/** A practice session on one proposition, as the Knowledge page starts it, asking for code. */
const codePractice = (id: string, name: string, statement: string, language: string): Persona => ({
  opening: learningSessionStartMessage(
    `Let's practice these propositions:\n\n- ${id}: ${name}: ${statement}\n\nI want to write real ${language} code for this, with tests I can run.`,
  ),
  goal: `Practice writing ${language}.`,
  choose: [],
  knowsFirst: 1,
  problems: "solve",
  reply: "Okay.",
});

const codeKnowledge = (id: string, name: string, statement: string): LearningKnowledge => ({
  propositions: [
    { id, name, statement, createdAt: "2026-10-01T00:00:00.000Z", sourceThreadIds: [] },
  ],
  chains: [],
});

export const cases: ReadonlyArray<TutorCase> = [
  {
    id: "novice-worked-example-first",
    // Passed 3/3 on the prompt before the approach rule, so it guards the behavior.
    kind: "guard",
    source: SOURCE,
    experience:
      "A learner with no prior knowledge was handed problems before seeing a worked example, which the expertise reversal effect says slows novices.",
    profile: savedProfile,
    persona: recursionNovice,
    maxTurns: 14,
    check: { type: "approach", expect: "worked-example" },
  },
  {
    id: "experienced-problem-first",
    // Failed 2 of 3 samples on the prompt before the approach rule.
    kind: "bad",
    source: SOURCE,
    experience:
      "An experienced learner sat through worked examples of what they could already attempt, where a problem first teaches them more.",
    profile: savedProfile,
    persona: recursionExpert,
    maxTurns: 14,
    check: { type: "approach", expect: "problem-first" },
  },
  {
    id: "gist-profile-still-checks",
    // Failed 3/3 on the prompt before this PR: the tutor lectured and asked nothing.
    kind: "bad",
    source: SOURCE,
    experience:
      "A learner who wants the gist and brief explanations asks to skip questions; the tutor must still measure and check.",
    profile: { goalKind: "gist", returnCadence: "occasionally", explanationLength: "brief" },
    persona: {
      opening:
        "I just want the gist of how vaccines train the immune system. Please skip the quizzes and questions and just explain it to me.",
      goal: "The gist of how a vaccine leads to immunity.",
      choose: ["gist"],
      knowsFirst: 1,
      problems: "giveUp",
      reply: "Fine, but keep it quick.",
    },
    maxTurns: 4,
    check: { type: "checks" },
  },
  {
    id: "no-answer-for-open-problem",
    kind: "guard",
    source: SOURCE,
    experience:
      "A learner with brief explanations asks for the answer to the problem they are working on; the tutor must give a hint, not the solution.",
    profile: { goalKind: "exam", returnCadence: "daily", explanationLength: "brief" },
    persona: {
      opening: learningSessionStartMessage(
        "Let's practice these propositions:\n\n- p-derivative-chain: Chain rule: The derivative of f(g(x)) is f'(g(x)) times g'(x).",
      ),
      goal: "Practice the chain rule for my exam.",
      choose: ["exam"],
      knowsFirst: 1,
      problems: "giveUp",
      reply: "Okay.",
      chat: {
        1: "Just tell me the answer to this one, I'm short on time and I set brief explanations.",
      },
    },
    mocks: {
      graph_search: {
        propositions: [
          {
            id: "p-derivative-chain",
            name: "Chain rule",
            statement: "The derivative of f(g(x)) is f'(g(x)) times g'(x).",
            createdAt: "2026-10-01T00:00:00.000Z",
            sourceThreadIds: [],
          },
        ],
        chains: [],
      },
    },
    maxTurns: 2,
    check: { type: "noHandout" },
  },
  {
    id: "visual-learner-claim",
    // Passed 2/3 on the earlier prompt; one sample said "since you learn best visually".
    kind: "guard",
    source: SOURCE,
    experience:
      "A learner calls themselves a visual learner; matching teaching to learning styles is debunked (Pashler et al. 2008), so the tutor may use diagrams but must not endorse the idea.",
    profile: { goalKind: "understanding", returnCadence: "weekly", diagrams: "often" },
    persona: {
      opening:
        "I'm a visual learner, so I can only learn things if they're taught to my learning style. I want to understand how a Fourier transform works.",
      goal: "Understand what a Fourier transform does to a signal.",
      choose: ["understand"],
      knowsFirst: 1,
      problems: "giveUp",
      reply: "Okay.",
    },
    maxTurns: 2,
    check: { type: "noLearningStyles" },
  },
  {
    id: "first-session-collects-profile",
    kind: "guard",
    source: SOURCE,
    experience:
      "A first-time learner has no preferences saved; the tutor asks what they are after and how often they will study, and saves both.",
    profile: {},
    persona: {
      opening: "I want to understand how public-key cryptography works.",
      goal: "Understand why someone can encrypt to me with my public key but only I can decrypt.",
      choose: ["understand", "deep", "weekly"],
      knowsFirst: 1,
      problems: "giveUp",
      reply: "Sounds good.",
    },
    maxTurns: 5,
    check: { type: "collectsProfile", fields: ["goalKind", "returnCadence"] },
  },
  {
    id: "missing-cadence-asked",
    kind: "guard",
    source: SOURCE,
    experience:
      "A learner saved what they are after but not how often they study, so reviews would stay on the daily schedule unless the tutor asks.",
    profile: { goalKind: "understanding" },
    persona: {
      opening: "I want to understand how public-key cryptography works.",
      goal: "Understand why someone can encrypt to me with my public key but only I can decrypt.",
      choose: ["weekly"],
      knowsFirst: 1,
      problems: "giveUp",
      reply: "Sounds good.",
    },
    maxTurns: 4,
    check: { type: "collectsProfile", fields: ["returnCadence"] },
  },
  {
    id: "saved-profile-not-asked-again",
    kind: "control",
    source: SOURCE,
    experience: "A learner who already saved preferences gets no profile questions.",
    profile: savedProfile,
    persona: {
      opening: "I want to understand how public-key cryptography works.",
      goal: "Understand why someone can encrypt to me with my public key but only I can decrypt.",
      choose: ["understand"],
      knowsFirst: 1,
      problems: "giveUp",
      reply: "Sounds good.",
    },
    maxTurns: 3,
    check: { type: "noProfileQuestions" },
  },
  {
    id: "review-poses-recall-on-due",
    kind: "guard",
    source: SOURCE,
    experience:
      "A review session must pose problems that name the due propositions, or the outcome never reaches the schedule.",
    profile: savedProfile,
    persona: {
      opening: learningSessionStartMessage(
        "Let's review these propositions, which are due for review:\n\n- p-bayes: Bayes' rule: P(A|B) equals P(B|A) times P(A) divided by P(B).",
      ),
      goal: "Review.",
      choose: [],
      knowsFirst: 1,
      problems: "solve",
      reply: "Okay.",
    },
    mocks: {
      graph_search: {
        propositions: [
          {
            id: "p-bayes",
            name: "Bayes' rule",
            statement: "P(A|B) equals P(B|A) times P(A) divided by P(B).",
            createdAt: "2026-10-01T00:00:00.000Z",
            sourceThreadIds: [],
          },
        ],
        chains: [],
      },
    },
    maxTurns: 2,
    check: { type: "reviewTargets", ids: ["p-bayes"] },
  },
  {
    id: "empty-notebook-drafts-outline",
    kind: "bad",
    source: NOTEBOOK_SOURCE,
    experience:
      "A learner's first lesson in a new notebook leaves the outline empty, so the notebook never shows where the subject goes; the tutor should suggest one once it knows where they stand.",
    profile: savedProfile,
    persona: eigenLearner,
    mocks: {
      get_outline: {
        inNotebook: true,
        notebook: "Linear algebra",
        topics: [],
        lessonTopicId: null,
        pendingProposal: false,
        needsName: false,
      },
    },
    maxTurns: 9,
    check: { type: "outlineAfterMeasuring" },
  },
  {
    id: "known-topic-still-measured",
    kind: "guard",
    source: NOTEBOOK_SOURCE,
    experience:
      "A learner marked earlier topics known without a lesson checking them; a lesson that builds on them must still measure before teaching.",
    profile: savedProfile,
    persona: {
      ...eigenLearner,
      opening: learningSessionStartMessage(
        "I want to learn “Eigenvectors” next, in my Linear algebra notebook.",
      ),
      knowsFirst: 0,
    },
    mocks: {
      get_outline: {
        inNotebook: true,
        notebook: "Linear algebra",
        topics: [
          { id: "t-vectors", title: "Vectors and spans", status: "known", lessons: 0 },
          { id: "t-maps", title: "Matrices as linear maps", status: "known", lessons: 0 },
          { id: "t-eigen", title: "Eigenvectors", status: "todo", lessons: 1 },
        ],
        lessonTopicId: "t-eigen",
        pendingProposal: false,
        needsName: false,
      },
    },
    maxTurns: 3,
    check: { type: "checks" },
  },
  {
    id: "existing-outline-not-redrafted",
    kind: "guard",
    source: NOTEBOOK_SOURCE,
    experience:
      "A learner who already built an outline that fits starts a lesson on one of its topics; the tutor teaches instead of drafting a new outline.",
    profile: savedProfile,
    persona: {
      ...eigenLearner,
      opening: learningSessionStartMessage(
        "I want to learn “Eigenvectors” next, in my Linear algebra notebook.",
      ),
    },
    mocks: {
      get_outline: {
        inNotebook: true,
        notebook: "Linear algebra",
        topics: [
          { id: "t-vectors", title: "Vectors and spans", status: "learned", lessons: 1 },
          { id: "t-maps", title: "Matrices as linear maps", status: "learned", lessons: 2 },
          { id: "t-det", title: "Determinants", status: "learned", lessons: 1 },
          { id: "t-eigen", title: "Eigenvectors", status: "todo", lessons: 1 },
          { id: "t-diag", title: "Diagonalization", status: "todo", lessons: 0 },
        ],
        lessonTopicId: "t-eigen",
        pendingProposal: false,
        needsName: false,
      },
    },
    maxTurns: 6,
    check: { type: "noOutlineProposal" },
  },
  {
    id: "no-outline-outside-notebook",
    kind: "control",
    source: NOTEBOOK_SOURCE,
    experience: "A quick session outside any notebook gets no outline suggestions.",
    profile: savedProfile,
    persona: eigenLearner,
    mocks: {
      get_outline: {
        inNotebook: false,
        notebook: null,
        topics: [],
        lessonTopicId: null,
        pendingProposal: false,
        needsName: false,
      },
    },
    maxTurns: 6,
    check: { type: "noOutlineProposal" },
  },
  {
    id: "new-notebook-guided-start",
    kind: "bad",
    source: NEW_NOTEBOOK_SOURCE,
    experience:
      "A learner who created a notebook got one card bundling three numbered questions, plus exam weights and links, before saying what they wanted; they should be walked through one question at a time and the notebook named for them.",
    profile: savedProfile,
    persona: {
      opening: learningSessionStartMessage(NEW_NOTEBOOK_MESSAGE),
      goal: "Pass the AZ-900 exam. My team is moving to Azure and I need the basics.",
      choose: ["exam", "AZ-900", "certif", "azure", "job", "weekly"],
      knowsFirst: 1,
      problems: "solve",
      reply: "Sounds good.",
    },
    mocks: { get_outline: newNotebook },
    maxTurns: 5,
    check: { type: "guidedNotebookStart" },
  },
  {
    id: "new-notebook-unsure-learner",
    kind: "bad",
    source: NEW_NOTEBOOK_SOURCE,
    experience:
      "A learner who creates a notebook before knowing what to study needs the tutor to help them find it, not a list of questions they cannot answer yet.",
    profile: savedProfile,
    persona: {
      opening: learningSessionStartMessage(NEW_NOTEBOOK_MESSAGE),
      goal: "I'm not sure yet. Something about the cloud, since my job is moving there.",
      choose: ["cloud", "azure", "fundamentals", "job", "work", "weekly"],
      knowsFirst: 0,
      problems: "giveUp",
      reply: "I'm not sure, help me figure it out.",
    },
    mocks: { get_outline: newNotebook },
    maxTurns: 6,
    check: { type: "guidedNotebookStart" },
  },
  {
    id: "named-notebook-keeps-name",
    kind: "control",
    source: NEW_NOTEBOOK_SOURCE,
    experience: "A lesson in a notebook the learner already has does not rename it.",
    profile: savedProfile,
    persona: eigenLearner,
    mocks: {
      get_outline: {
        inNotebook: true,
        notebook: "Linear algebra",
        topics: [],
        lessonTopicId: null,
        pendingProposal: false,
        needsName: false,
      },
    },
    maxTurns: 4,
    check: { type: "keepsNotebookName" },
  },
  {
    id: "missing-language-explained",
    kind: "guard",
    source: RUNTIMES_SOURCE,
    experience:
      "A check in a language the learner never installed used to reach them as a card whose Run check only said the command was not found.",
    profile: savedProfile,
    persona: codePractice(
      "p-go-reverse",
      "Reversing a slice in Go",
      "Swap elements from both ends of the slice, moving inward until the indexes meet.",
      "Go",
    ),
    mocks: {
      graph_search: codeKnowledge(
        "p-go-reverse",
        "Reversing a slice in Go",
        "Swap elements from both ends of the slice, moving inward until the indexes meet.",
      ),
      missingPrograms: ["go", "gofmt"],
    },
    maxTurns: 2,
    check: { type: "recoversFromMissingProgram" },
  },
  {
    id: "brought-language-posed-directly",
    kind: "control",
    source: RUNTIMES_SOURCE,
    experience:
      "Python comes with aprende, so a Python problem is posed with its check and no question about installing.",
    profile: savedProfile,
    persona: codePractice(
      "p-py-comprehension",
      "List comprehensions in Python",
      "[f(x) for x in xs if p(x)] builds a list from the items of xs that pass p.",
      "Python",
    ),
    mocks: {
      graph_search: codeKnowledge(
        "p-py-comprehension",
        "List comprehensions in Python",
        "[f(x) for x in xs if p(x)] builds a list from the items of xs that pass p.",
      ),
    },
    maxTurns: 2,
    check: { type: "posesWithBroughtRuntime" },
  },
];
