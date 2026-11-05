import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  learningAnswerMessageQuestionId,
  learningSolutionMessageProblemId,
} from "@aprende/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as LearningService from "./LearningService.ts";

const threadId = ThreadId.make("thread-learning");
const otherThreadId = ThreadId.make("thread-learning-other");

interface Spawned {
  readonly args: ReadonlyArray<string>;
  readonly options: { readonly cwd?: string };
}

const makeHandle = (input: {
  readonly stdout: Stream.Stream<Uint8Array>;
  readonly exitCode: Effect.Effect<ChildProcessSpawner.ExitCode>;
}) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: input.exitCode,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: input.stdout,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

const makeLayer = (
  sent: Ref.Ref<ReadonlyArray<string>>,
  options?: {
    readonly sendFails?: boolean;
    /** The session's folder, where practice folders go. */
    readonly root?: string;
    readonly spawn?: (command: Spawned) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle>;
  },
) =>
  LearningService.layer.pipe(
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed({
            projectId: ProjectId.make("project-learning"),
            worktreePath: null,
          } as never),
        sendToThread: (input) =>
          options?.sendFails === true
            ? Effect.die("provider is down")
            : Ref.update(sent, (texts) => [...texts, input.text]).pipe(Effect.as({} as never)),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: () =>
          Effect.succeedSome({ workspaceRoot: options?.root ?? process.cwd() } as never),
      }),
    ),
    Layer.provide(
      ProcessRunner.layer.pipe(
        Layer.provide(
          Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make((command) =>
              options?.spawn === undefined
                ? Effect.die("no process expected")
                : options.spawn(command as unknown as Spawned),
            ),
          ),
        ),
      ),
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

const problemDraft = {
  mode: "compose" as const,
  statement: "Order: build, test, deploy, where deploy needs test and test needs build.",
  targets: ["prerequisites first"],
  modelSolution: "Build, then test, then deploy.",
  hints: ["What has no prerequisite?", "Build comes first."],
};

it.effect("keeps the solution and unrevealed hints on the server until the tutor concludes", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const { problemId } = yield* learning.poseProblem(threadId, problemDraft);
      const problemOf = Effect.map(
        learning.getThreadState(threadId),
        (state) => state.problems[0]!,
      );

      const posed = yield* problemOf;
      assert.equal(posed.status, "open");
      assert.isNull(posed.workspace);
      assert.deepEqual(posed.hints, []);
      assert.equal(posed.hintCount, 2);
      assert.isNull(posed.modelSolution);

      const first = yield* learning.revealHint({ threadId, problemId });
      assert.deepEqual(first.problem.hints, ["What has no prerequisite?"]);
      const second = yield* learning.revealHint({ threadId, problemId });
      assert.deepEqual(second.problem.hints, problemDraft.hints);
      assert.equal(second.problem.hintsUsed, 2);
      assert.isTrue(
        Exit.isFailure(yield* learning.revealHint({ threadId, problemId }).pipe(Effect.exit)),
      );

      const early = yield* learning
        .concludeProblem(threadId, { problemId, outcome: "solved", verdict: "Yes.", retest: false })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(early));

      const work = { threadId, problemId, text: "Build, test, deploy.", gaveUp: false };
      const submitted = yield* learning.submitSolution({ ...work, confidence: 30 });
      assert.equal(submitted.problem.status, "submitted");
      assert.isNull(submitted.problem.modelSolution);
      assert.isTrue(Exit.isFailure(yield* learning.submitSolution(work).pipe(Effect.exit)));
      assert.isTrue(
        Exit.isFailure(yield* learning.revealHint({ threadId, problemId }).pipe(Effect.exit)),
      );
      const texts = yield* Ref.get(sent);
      assert.equal(texts.length, 1);
      assert.equal(learningSolutionMessageProblemId(texts[0]!), problemId);
      assert.include(texts[0]!, "Hints used: 2 of 2");
      assert.include(texts[0]!, "Confidence: 30%");

      const wrongThread = yield* learning
        .concludeProblem(otherThreadId, {
          problemId,
          outcome: "solved",
          verdict: "Yes.",
          retest: false,
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(wrongThread));
      yield* learning.concludeProblem(threadId, {
        problemId,
        outcome: "solved",
        verdict: "Right order.",
        retest: true,
      });
      const concluded = yield* problemOf;
      assert.equal(concluded.status, "concluded");
      assert.equal(concluded.modelSolution, problemDraft.modelSolution);
      assert.equal(concluded.conclusion?.retest, true);
      assert.isTrue(
        Exit.isFailure(
          yield* learning
            .concludeProblem(threadId, {
              problemId,
              outcome: "missed",
              verdict: "No.",
              retest: false,
            })
            .pipe(Effect.exit),
        ),
      );
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);

it.effect("reopens the problem when the work cannot reach the tutor", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const { problemId } = yield* learning.poseProblem(threadId, problemDraft);
      const exit = yield* learning
        .submitSolution({ threadId, problemId, gaveUp: true })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      const problem = (yield* learning.getThreadState(threadId)).problems[0]!;
      assert.equal(problem.status, "open");
      assert.isNull(problem.attempt);
    }).pipe(Effect.provide(makeLayer(sent, { sendFails: true })));
  }),
);

it.effect("keeps one card open at a time and retests only problems of the same session", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const question = yield* learning.askQuestion(threadId, measureQuestion);
      const first = yield* learning.poseProblem(threadId, problemDraft);
      const second = yield* learning.poseProblem(threadId, problemDraft);
      const state = yield* learning.getThreadState(threadId);
      assert.equal(state.questions[0]!.id, question.questionId);
      assert.equal(state.questions[0]!.status, "skipped");
      assert.deepEqual(
        state.problems.map((problem) => [problem.id, problem.status]),
        [
          [first.problemId, "skipped"],
          [second.problemId, "open"],
        ],
      );

      yield* learning.submitSolution({ threadId, problemId: second.problemId, gaveUp: true });
      // Work waiting for a verdict blocks the next problem, so no attempt goes unjudged.
      const unjudged = yield* learning.poseProblem(threadId, problemDraft).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(unjudged));
      yield* learning.concludeProblem(threadId, {
        problemId: second.problemId,
        outcome: "missed",
        verdict: "Start from what has no prerequisite.",
        missType: "gap",
        retest: true,
      });

      const recorded = yield* learning.recordGraph(otherThreadId, {
        propositions: [{ key: "edge", name: "Edges", statement: "Edges point forward." }],
        chains: [],
      });
      const edgeId = recorded.propositions[0]!.id;
      const elsewhere = yield* learning.poseProblem(otherThreadId, {
        ...problemDraft,
        targets: [edgeId, "cycles"],
      });
      assert.deepEqual((yield* learning.getThreadState(otherThreadId)).problems[0]!.targets, [
        { name: "Edges", propositionId: edgeId },
        { name: "cycles", propositionId: null },
      ]);
      const foreign = yield* learning
        .poseProblem(threadId, { ...problemDraft, retestOf: elsewhere.problemId })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(foreign));
      yield* learning.poseProblem(threadId, { ...problemDraft, retestOf: second.problemId });
      const retest = (yield* learning.getThreadState(threadId)).problems.at(-1)!;
      assert.equal(retest.retestOf, second.problemId);
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

      const sql = yield* SqlClient.SqlClient;
      for (const [id, deletedAt] of [
        [threadId, null],
        [otherThreadId, "2026-01-02T00:00:00.000Z"],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
          thread_id: id,
          project_id: "project-learning",
          title: "Dependency maps",
          default_provider: "claude",
          runtime_mode: "auto",
          interaction_mode: "default",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: deletedAt,
          payload_json: "{}",
        })}`;
      }

      const knowledge = yield* learning.getKnowledge();
      // Deleted sessions drop out, so the client never links to a thread that is gone.
      assert.deepEqual(knowledge.sessions, [
        {
          threadId,
          projectId: ProjectId.make("project-learning"),
          title: "Dependency maps",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]);
      assert.equal(knowledge.propositions.length, 2);
      assert.sameMembers(
        [...knowledge.propositions.find((entry) => entry.id === edgeId)!.sourceThreadIds],
        [threadId, otherThreadId],
      );
      assert.equal(knowledge.chains.length, 1);
      const found = yield* learning.searchGraph({ query: "prerequisites order" });
      // The chain into "Order" brings its premise along.
      assert.deepEqual(
        found.propositions.map((entry) => entry.name),
        ["Order", "Edges"],
      );
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);

const codingProblem = {
  ...problemDraft,
  statement: "Print the build order.",
  workspace: {
    name: "Build order",
    files: [
      { path: "main.py", contents: "print('todo')\n" },
      { path: "tests/test_main.py", contents: "import unittest\n" },
    ],
    checkCommand: "python3 -m unittest",
  },
};

it.effect("writes starter files into a fresh practice folder and never into an existing one", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-practice-" });
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const first = yield* learning.poseProblem(threadId, codingProblem);
      const workspace = (yield* learning.getThreadState(threadId)).problems[0]!.workspace!;
      assert.match(workspace.folder, /^practice\/build-order-[0-9a-f]{8}$/);
      assert.deepEqual(workspace.files, ["main.py", "tests/test_main.py"]);
      assert.equal(workspace.checkCommand, "python3 -m unittest");
      const main = path.join(root, workspace.folder, "main.py");
      assert.equal(
        yield* fileSystem.readFileString(path.join(root, workspace.folder, "tests/test_main.py")),
        "import unittest\n",
      );

      yield* fileSystem.writeFileString(main, "print('mine')\n");
      yield* learning.poseProblem(threadId, { ...codingProblem, retestOf: first.problemId });
      const second = (yield* learning.getThreadState(threadId)).problems[1]!.workspace!;
      assert.notEqual(second.folder, workspace.folder);
      assert.equal(yield* fileSystem.readFileString(main), "print('mine')\n");

      // A folder that cannot be made leaves no problem behind for the learner.
      yield* fileSystem.remove(path.join(root, "practice"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(root, "practice"), "not a folder");
      const blocked = yield* learning.poseProblem(otherThreadId, codingProblem).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(blocked));
      assert.deepEqual((yield* learning.getThreadState(otherThreadId)).problems, []);
    }).pipe(Effect.provide(makeLayer(sent, { root })));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("runs the check in the practice folder, capping its output and stopping it at 30 s", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-practice-" });
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const spawned = yield* Ref.make<ReadonlyArray<Spawned>>([]);
    const hang = yield* Ref.make(false);
    const drained = yield* Deferred.make<void>();
    const spawn = (command: Spawned) =>
      Effect.gen(function* () {
        yield* Ref.update(spawned, (all) => [...all, command]);
        if (yield* Ref.get(hang))
          return makeHandle({
            stdout: Stream.encodeText(Stream.make("started\n")).pipe(
              Stream.ensuring(Deferred.succeed(drained, undefined)),
            ),
            exitCode: Effect.never,
          });
        return makeHandle({
          stdout: Stream.encodeText(Stream.make("x".repeat(40_000), "y".repeat(40_000))),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
        });
      });
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const { problemId } = yield* learning.poseProblem(threadId, codingProblem);
      const folder = (yield* learning.getThreadState(threadId)).problems[0]!.workspace!.folder;

      const capped = yield* learning.runCheck({ threadId, problemId });
      assert.equal(capped.exitCode, 1);
      assert.isFalse(capped.timedOut);
      assert.isTrue(capped.truncated);
      assert.equal(capped.output.length, 64 * 1024);
      const [command] = yield* Ref.get(spawned);
      assert.equal(command!.options.cwd, path.join(root, folder));
      assert.include(command!.args.join(" "), "python3 -m unittest");

      yield* Ref.set(hang, true);
      const running = yield* learning
        .runCheck({ threadId, problemId })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(drained);
      yield* TestClock.adjust("30 seconds");
      // Output written before the timeout still reaches the learner.
      assert.deepEqual(yield* Fiber.join(running), {
        exitCode: null,
        timedOut: true,
        output: "started\n",
        truncated: false,
      });

      yield* fileSystem.remove(path.join(root, folder), { recursive: true });
      const gone = yield* learning.runCheck({ threadId, problemId });
      assert.isNull(gone.exitCode);
      assert.include(gone.output, "is gone");
      assert.equal((yield* Ref.get(spawned)).length, 2);

      yield* learning.poseProblem(threadId, problemDraft);
      const plain = (yield* learning.getThreadState(threadId)).problems[1]!;
      assert.isTrue(
        Exit.isFailure(
          yield* learning.runCheck({ threadId, problemId: plain.id }).pipe(Effect.exit),
        ),
      );
    }).pipe(Effect.provide(makeLayer(sent, { root, spawn })));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("runs the check once more on submit and hands the tutor the folder and the result", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-practice-" });
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const runs = yield* Ref.make(0);
    const spawn = () =>
      Ref.update(runs, (count) => count + 1).pipe(
        Effect.as(
          makeHandle({
            stdout: Stream.encodeText(Stream.make("Ran 2 tests\nOK\n")),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          }),
        ),
      );
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const { problemId } = yield* learning.poseProblem(threadId, codingProblem);
      const folder = (yield* learning.getThreadState(threadId)).problems[0]!.workspace!.folder;

      const { problem } = yield* learning.submitSolution({
        threadId,
        problemId,
        gaveUp: false,
        confidence: 80,
      });
      assert.equal(problem.status, "submitted");
      assert.deepEqual(problem.attempt?.check, { exitCode: 0, timedOut: false });
      assert.equal(yield* Ref.get(runs), 1);
      const [text] = yield* Ref.get(sent);
      assert.equal(learningSolutionMessageProblemId(text!), problemId);
      assert.include(
        text!,
        `Practice folder: ${folder}/ (starter files: main.py, tests/test_main.py)`,
      );
      assert.include(text!, "Check `python3 -m unittest` exited with code 0. Output:");
      assert.include(text!, "Ran 2 tests\nOK");

      // Text-only problems still need written work.
      const plain = yield* learning.poseProblem(otherThreadId, problemDraft);
      const empty = yield* learning
        .submitSolution({ threadId: otherThreadId, problemId: plain.problemId, gaveUp: false })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(empty));
    }).pipe(Effect.provide(makeLayer(sent, { root, spawn })));
  }).pipe(Effect.provide(NodeServices.layer)),
);
