import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId, learningAnswerMessageQuestionId } from "@aprende/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { ServerConfig } from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as LearningService from "./LearningService.ts";

const threadId = ThreadId.make("thread-learning");
const otherThreadId = ThreadId.make("thread-learning-other");

const makeLayer = (
  sent: Ref.Ref<ReadonlyArray<string>>,
  options?: { readonly sendFails?: boolean },
) =>
  LearningService.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed({ projectId: ProjectId.make("project-learning") } as never),
        sendToThread: (input) =>
          options?.sendFails === true
            ? Effect.die("provider is down")
            : Ref.update(sent, (texts) => [...texts, input.text]).pipe(Effect.as({} as never)),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "aprende-learning-" })),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const measureQuestion = {
  purpose: "measure" as const,
  format: "choice" as const,
  question: "What does an edge mean?",
  options: ["A must come before B", "B must come before A", "They are unrelated"],
  correctOptions: [0],
  explanation: "Edges point from prerequisite to dependent.",
};

it.effect("keeps the committed answer on the server until the learner answers once", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const { questionId } = yield* learning.askQuestion(threadId, measureQuestion);

      const before = (yield* learning.getThreadState(threadId)).questions[0]!;
      assert.equal(before.status, "open");
      assert.isNull(before.reveal);
      const correctIndex = before.options.indexOf("A must come before B");

      const result = yield* learning.answer({
        threadId,
        questionId,
        selectedOptions: [correctIndex],
        dontKnow: false,
        confidence: 70,
        thinking: "Prerequisites first.",
      });
      assert.isTrue(result.question.answer?.correct);
      assert.deepEqual(result.question.reveal?.correctOptions, [correctIndex]);

      const texts = yield* Ref.get(sent);
      assert.equal(texts.length, 1);
      assert.equal(learningAnswerMessageQuestionId(texts[0]!), questionId);
      assert.include(texts[0]!, "Confidence: 70%");

      const again = yield* learning
        .answer({ threadId, questionId, selectedOptions: [correctIndex], dontKnow: false })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(again));
      assert.equal((yield* Ref.get(sent)).length, 1);

      const wrongThread = yield* learning
        .answer({ threadId: otherThreadId, questionId, selectedOptions: [0], dontKnow: false })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(wrongThread));
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);

it.effect("reopens the question when the answer cannot reach the tutor", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const { questionId } = yield* learning.askQuestion(threadId, measureQuestion);
      const exit = yield* learning
        .answer({ threadId, questionId, selectedOptions: [0], dontKnow: false })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      const question = (yield* learning.getThreadState(threadId)).questions[0]!;
      assert.equal(question.status, "open");
      assert.isNull(question.answer);
    }).pipe(Effect.provide(makeLayer(sent, { sendFails: true })));
  }),
);

it.effect("replaces an unanswered question and derives the phase and current node", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const first = yield* learning.askQuestion(threadId, measureQuestion);
      assert.equal((yield* learning.getThreadState(threadId)).phase, "measure");

      yield* learning.finishMeasuring(threadId, {
        goal: "Understand plans",
        strands: [{ name: "Graphs", solid: "Nodes", breaksAt: "Edges", startFrom: "Edges" }],
      });
      assert.equal((yield* learning.getThreadState(threadId)).phase, "plan");

      const cycle = yield* learning
        .setPlan(threadId, {
          nodes: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ],
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(cycle));
      yield* learning.setPlan(threadId, {
        nodes: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      });

      const second = yield* learning.askQuestion(threadId, {
        ...measureQuestion,
        purpose: "check",
        planNodeId: "b",
      });
      const state = yield* learning.getThreadState(threadId);
      assert.equal(state.phase, "teach");
      assert.equal(state.currentNodeId, "b");
      assert.deepEqual(
        state.questions.map((question) => [question.id, question.status]),
        [
          [first.questionId, "skipped"],
          [second.questionId, "open"],
        ],
      );
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);

it.effect("links propositions across sessions instead of duplicating them", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const first = yield* learning.recordGraph(threadId, {
        propositions: [
          {
            key: "edge",
            name: "Edges",
            statement: "An edge points from prerequisite to dependent.",
          },
          { key: "order", name: "Order", statement: "A valid order lists prerequisites first." },
        ],
        chains: [{ premises: ["edge"], conclusion: "order" }],
      });
      const edgeId = first.propositions.find((entry) => entry.key === "edge")!.id;

      yield* learning.recordGraph(otherThreadId, {
        propositions: [{ key: "same", name: "Edges", statement: "Same idea.", sameAs: edgeId }],
        chains: [],
      });
      const unknown = yield* learning
        .recordGraph(otherThreadId, {
          propositions: [],
          chains: [{ premises: ["missing"], conclusion: edgeId }],
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(unknown));

      const knowledge = yield* learning.getKnowledge();
      assert.equal(knowledge.propositions.length, 2);
      assert.sameMembers(
        [...knowledge.propositions.find((entry) => entry.id === edgeId)!.sourceThreadIds],
        [threadId, otherThreadId],
      );
      assert.equal(knowledge.chains.length, 1);
      const found = yield* learning.searchGraph({ query: "prerequisites order" });
      assert.deepEqual(
        found.propositions.map((entry) => entry.name),
        ["Order"],
      );
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);
