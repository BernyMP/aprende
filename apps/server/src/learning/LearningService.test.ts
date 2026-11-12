import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2ServerCommand,
  NEW_NOTEBOOK_TITLE,
  ProjectId,
  ThreadId,
  learningAnswerMessageQuestionId,
  learningSolutionMessageProblemId,
} from "@aprende/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { learnerProfileSection } from "./learnerProfile.ts";
import * as LearningService from "./LearningService.ts";
import * as PracticeRuntimes from "./PracticeRuntimes.ts";
import { readTutorInstructions } from "./tutorPrompt.ts";

const threadId = ThreadId.make("thread-learning");
const otherThreadId = ThreadId.make("thread-learning-other");

interface Spawned {
  readonly args: ReadonlyArray<string>;
  readonly options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv };
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
    /** A worktree an older release recorded for the session. */
    readonly worktreePath?: string;
    readonly dispatched?: Ref.Ref<ReadonlyArray<OrchestrationV2ServerCommand>>;
    readonly spawn?: (command: Spawned) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle>;
    /** Whether the session runs outside any notebook. */
    readonly scratch?: boolean;
    readonly notebook?: { readonly title: string; readonly projectIcon?: unknown };
    readonly projectUpdates?: Ref.Ref<ReadonlyArray<ProjectService.ProjectUpdateInput>>;
    /** Waiting for aprende's Python; succeeds unless given. */
    readonly python?: Effect.Effect<void, PracticeRuntimes.PracticeRuntimeError>;
  },
) =>
  LearningService.layer.pipe(
    Layer.provide(
      Layer.mock(PracticeRuntimes.PracticeRuntimes)({
        env: Effect.succeed({ PATH: "/aprende/bin:/usr/bin" }),
        python: options?.python ?? Effect.void,
        warmPython: Effect.void,
        isMissing: (program) => Effect.succeed(program === "go"),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed({
            projectId: ProjectId.make("project-learning"),
            worktreePath: options?.worktreePath ?? null,
          } as never),
        sendToThread: (input) =>
          options?.sendFails === true
            ? Effect.die("provider is down")
            : Ref.update(sent, (texts) => [...texts, input.text]).pipe(Effect.as({} as never)),
        dispatch: (command) =>
          options?.dispatched === undefined
            ? Effect.die("no dispatch expected")
            : Ref.update(options.dispatched, (commands) => [...commands, command]).pipe(
                Effect.as({} as never),
              ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: () =>
          Effect.succeedSome({
            title: options?.notebook?.title ?? "Linear algebra",
            projectIcon: options?.notebook?.projectIcon ?? null,
            workspaceRoot: options?.root ?? process.cwd(),
          } as never),
        update: (input) =>
          options?.projectUpdates === undefined
            ? Effect.die("no project update expected")
            : Ref.update(options.projectUpdates, (updates) => [...updates, input]).pipe(
                Effect.as({} as never),
              ),
      }),
    ),
    Layer.provide(
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        isScratchProject: () => Effect.succeed(options?.scratch === true),
        namedProjectsRoot: process.cwd(),
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
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "aprende-learning-" })),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
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
        confidence: "fairlySure",
        thinking: "Prerequisites first.",
      });
      assert.isTrue(result.question.answer?.correct);
      assert.deepEqual(result.question.reveal?.correctOptions, [correctIndex]);

      const texts = yield* Ref.get(sent);
      assert.equal(texts.length, 1);
      assert.equal(learningAnswerMessageQuestionId(texts[0]!), questionId);
      assert.include(texts[0]!, "Confidence: Fairly sure");

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

      const dump = yield* learning
        .finishMeasuring(threadId, {
          goal: "Understand plans",
          strands: [{ name: "Graphs", level: "new", breaksAt: "Edges. ".repeat(40) }],
        })
        .pipe(Effect.exit);
      assert.include(JSON.stringify(dump), "Shorten breaksAt");
      assert.equal((yield* learning.getThreadState(threadId)).phase, "measure");

      yield* learning.finishMeasuring(threadId, {
        goal: "Understand plans",
        strands: [
          {
            name: "Graphs",
            level: "partial",
            solid: " Nodes ",
            breaksAt: "Edges",
            misconceptions: "None observed.",
          },
        ],
        summary: " ",
      });
      const measured = yield* learning.getThreadState(threadId);
      assert.equal(measured.phase, "plan");
      assert.deepEqual(
        { strands: measured.assessment?.strands, summary: measured.assessment?.summary },
        {
          strands: [{ name: "Graphs", level: "partial", solid: "Nodes", breaksAt: "Edges" }],
          summary: undefined,
        },
      );

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
      const submitted = yield* learning.submitSolution({ ...work, confidence: "guessing" });
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
      assert.include(texts[0]!, "Confidence: Guessing");

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

it.effect("schedules practiced propositions for spaced review from practice outcomes", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const recorded = yield* learning.recordGraph(threadId, {
        propositions: [
          { key: "edge", name: "Edges", statement: "Edges point forward." },
          { key: "order", name: "Order", statement: "Prerequisites come first." },
        ],
        chains: [],
      });
      const [edgeId, orderId] = recorded.propositions.map((entry) => entry.id);
      const dueIds = Effect.map(learning.dueForReview({}), (due) =>
        due.propositions.map((entry) => entry.id),
      );
      const boxOf = (id: string) =>
        Effect.map(
          learning.getKnowledge(),
          (knowledge) => knowledge.reviews.find((review) => review.propositionId === id)!.box,
        );
      const practice = Effect.fn(function* (
        targets: ReadonlyArray<string>,
        outcome: "solved" | "missed",
      ) {
        const { problemId } = yield* learning.poseProblem(threadId, { ...problemDraft, targets });
        yield* learning.submitSolution({ threadId, problemId, text: "Work.", gaveUp: false });
        yield* learning.concludeProblem(threadId, {
          problemId,
          outcome,
          verdict: "Judged.",
          retest: false,
        });
      });

      assert.deepEqual(yield* dueIds, []);
      yield* TestClock.adjust("1 day");
      assert.sameMembers(yield* dueIds, [edgeId, orderId]);

      yield* practice([edgeId!], "solved");
      assert.equal(yield* boxOf(edgeId!), 1);
      assert.deepEqual(yield* dueIds, [orderId]);
      yield* practice([edgeId!], "missed");
      assert.equal(yield* boxOf(edgeId!), 0);

      yield* learning.snoozeReview({ propositionIds: [orderId!], days: 7 });
      assert.deepEqual(yield* dueIds, []);
      yield* learning.snoozeReview({ propositionIds: [orderId!], days: null });
      assert.deepEqual(yield* dueIds, [orderId]);

      // A weekly learner's first review waits a week, applied to what is already scheduled.
      yield* learning.updateProfile({ returnCadence: "weekly" });
      assert.deepEqual(yield* dueIds, []);
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);

it.effect("adds the learner profile to what the tutor runs on, never to the editable prompt", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      assert.deepEqual(yield* learning.getProfile(), {});
      const empty = yield* learning.updateProfile({}).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(empty));

      yield* learning.updateProfile({ goalKind: "exam", language: "Spanish" });
      const saved = yield* learning.updateProfile({ language: null, explanationLength: "brief" });
      assert.deepEqual(saved, { goalKind: "exam", explanationLength: "brief" });
      const prompt = yield* learning.getTutorPrompt();
      assert.isTrue(prompt.isDefault);
      assert.equal(prompt.prompt, prompt.defaultPrompt);

      const { stateDir } = yield* ServerConfig;
      const instructions = yield* readTutorInstructions({
        fileSystem: yield* FileSystem.FileSystem,
        path: yield* Path.Path,
        stateDir,
      });
      assert.equal(instructions, `${prompt.defaultPrompt}\n\n${learnerProfileSection(saved)}`);
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
    const removedWorktree = path.join(root, "removed-worktree");
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      // A check whose program the learner lacks is refused before anything is written.
      const lacking = yield* Effect.flip(
        learning.poseProblem(threadId, {
          ...codingProblem,
          workspace: { ...codingProblem.workspace, checkCommand: "go test ./..." },
        }),
      );
      assert.include(lacking.message, "`go` is not installed");
      assert.isFalse(yield* fileSystem.exists(path.join(root, "practice")));

      const first = yield* learning.poseProblem(threadId, codingProblem);
      assert.deepInclude((yield* Ref.get(dispatched))[0], {
        type: "thread.metadata.update",
        threadId,
        worktreePath: null,
        expectedWorktreePath: removedWorktree,
      });
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

      // A symlinked practice folder must not carry starter files out of the session folder.
      const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-outside-" });
      yield* fileSystem.remove(path.join(root, "practice"));
      yield* fileSystem.symlink(outside, path.join(root, "practice"));
      const escaped = yield* learning.poseProblem(otherThreadId, codingProblem).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(escaped));
      assert.deepEqual(yield* fileSystem.readDirectory(outside), []);
    }).pipe(
      // A removed worktree leaves the session in its project folder, and the thread forgets it.
      Effect.provide(makeLayer(sent, { root, worktreePath: removedWorktree, dispatched })),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("runs the check in the practice folder, capping its output and stopping it at 30 s", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-practice-" });
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const spawned = yield* Ref.make<ReadonlyArray<Spawned>>([]);
    const spawnedAt = yield* Ref.make<ReadonlyArray<number>>([]);
    const hang = yield* Ref.make(false);
    const pythonDown = yield* Ref.make(false);
    const python = Ref.get(pythonDown).pipe(
      Effect.flatMap((down) =>
        down
          ? Effect.fail(new PracticeRuntimes.PracticeRuntimeError({ step: "download" }))
          : Effect.void,
      ),
    );
    const drained = yield* Deferred.make<void>();
    const spawn = (command: Spawned) =>
      Effect.gen(function* () {
        yield* Ref.update(spawned, (all) => [...all, command]);
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(spawnedAt, (all) => [...all, now]);
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
      assert.equal(
        yield* learning.practiceFolder({ threadId, problemId }),
        path.join(root, folder),
      );
      assert.include(command!.args.join(" "), "python3 -m unittest");
      assert.equal(command!.options.env?.["PATH"], "/aprende/bin:/usr/bin");

      yield* Ref.set(hang, true);
      const running = yield* learning
        .runCheck({ threadId, problemId })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(drained);
      yield* Ref.set(hang, false);
      const overlapping = yield* learning
        .runCheck({ threadId, problemId })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust("30 seconds");
      // Output written before the timeout still reaches the learner.
      assert.deepEqual(yield* Fiber.join(running), {
        exitCode: null,
        timedOut: true,
        output: "started\n",
        truncated: false,
      });
      // A second check in the same folder waits for the first instead of overlapping it.
      assert.equal((yield* Fiber.join(overlapping)).exitCode, 1);
      assert.isAtLeast((yield* Ref.get(spawnedAt))[2]!, 30_000);

      // Without aprende's Python the check still runs, on the learner's own if they have one.
      // When it fails, the learner reads why before its output.
      yield* Ref.set(pythonDown, true);
      const noPython = yield* learning.runCheck({ threadId, problemId });
      assert.equal(noPython.exitCode, 1);
      assert.match(noPython.output, /^aprende could not set up Python.*\n\nx/);
      assert.equal((yield* Ref.get(spawned)).length, 4);
      yield* Ref.set(pythonDown, false);

      yield* fileSystem.remove(path.join(root, folder), { recursive: true });
      const gone = yield* learning.runCheck({ threadId, problemId });
      assert.isNull(gone.exitCode);
      assert.include(gone.output, "is gone");
      assert.equal((yield* Ref.get(spawned)).length, 4);
      assert.include(
        (yield* Effect.flip(learning.practiceFolder({ threadId, problemId }))).message,
        "is gone",
      );

      yield* learning.poseProblem(threadId, problemDraft);
      const plain = (yield* learning.getThreadState(threadId)).problems[1]!;
      assert.isTrue(
        Exit.isFailure(
          yield* learning.runCheck({ threadId, problemId: plain.id }).pipe(Effect.exit),
        ),
      );
      assert.equal(
        (yield* Effect.flip(learning.practiceFolder({ threadId, problemId: plain.id }))).message,
        "This problem has no practice folder.",
      );
    }).pipe(Effect.provide(makeLayer(sent, { root, spawn, python })));
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
        confidence: "certain",
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

it.effect("applies the tutor's outline changes only once the learner accepts them", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      const projectId = ProjectId.make("project-learning");

      const first = yield* learning.proposeOutline(threadId, {
        ops: [
          { type: "add", title: "Vectors" },
          { type: "add", title: "Linear maps" },
        ],
        reason: "A first outline.",
      });
      const second = yield* learning.proposeOutline(threadId, {
        ops: [
          { type: "add", title: "Vectors" },
          { type: "add", title: "Matrices" },
          { type: "add", title: "Eigenvectors" },
        ],
        reason: "Matrices come before eigenvectors.",
      });
      // Nothing applies until the learner accepts, and only the newest proposal waits.
      const empty = (yield* learning.tutorOutline(threadId)).topics;
      assert.deepEqual(empty, []);
      // Until one is accepted, each drafts the notebook's first outline, and none is needed.
      assert.deepEqual([first.firstOutline, second.firstOutline], [true, true]);
      assert.isFalse((yield* learning.tutorOutline(threadId)).needsOutline);
      const replaced = yield* learning
        .resolveProposal({ proposalId: first.proposalId, accept: true })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(replaced));
      assert.deepEqual(
        (yield* learning.getThreadState(threadId)).proposals.map((entry) => entry.status),
        ["replaced", "pending"],
      );

      yield* learning.resolveProposal({ proposalId: second.proposalId, accept: true });
      const outline = yield* learning.tutorOutline(threadId);
      assert.deepEqual(
        outline.topics.map((topic) => [topic.title, topic.status]),
        [
          ["Vectors", "todo"],
          ["Matrices", "todo"],
          ["Eigenvectors", "todo"],
        ],
      );
      assert.isFalse(outline.pendingProposal);
      const [vectors, matrices, eigen] = outline.topics;

      // A proposal naming a topic that does not exist fails, so the tutor can fix it.
      const unknown = yield* learning
        .proposeOutline(threadId, { ops: [{ type: "remove", topicId: "t-nope" }], reason: "x" })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(unknown));

      // The learner edits meanwhile; accepting later skips what their edit made moot.
      const late = yield* learning.proposeOutline(threadId, {
        ops: [
          { type: "rename", topicId: matrices!.id, title: "Matrices as maps" },
          { type: "setStatus", topicId: vectors!.id, status: "known" },
        ],
        reason: "They already hold vectors.",
      });
      assert.isFalse(late.firstOutline);
      yield* learning.editOutline({
        projectId,
        ops: [{ type: "remove", topicId: matrices!.id }],
      });
      yield* learning.resolveProposal({ proposalId: late.proposalId, accept: true });
      assert.deepEqual(
        (yield* learning.tutorOutline(threadId)).topics.map((topic) => [topic.title, topic.status]),
        [
          ["Vectors", "known"],
          ["Eigenvectors", "todo"],
        ],
      );

      // A dismissed proposal changes nothing.
      const dismissed = yield* learning.proposeOutline(threadId, {
        ops: [{ type: "remove", topicId: eigen!.id }],
        reason: "x",
      });
      yield* learning.resolveProposal({ proposalId: dismissed.proposalId, accept: false });
      assert.equal((yield* learning.tutorOutline(threadId)).topics.length, 2);

      // Starting a lesson links it before its thread reaches the projection; the notebook lists it
      // at once, so the learner is not offered the same topic again.
      const loose = yield* learning.markTopicLearned(threadId).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(loose));
      yield* learning.setLessonTopic({ projectId, threadId, topicId: eigen!.id });
      const notebook = yield* learning.subscribeNotebook(projectId).pipe(Stream.runHead);
      assert.deepEqual(Option.getOrThrow(notebook).lessons, [{ threadId, topicId: eigen!.id }]);
      const lessonsOnEigen = Effect.map(
        learning.tutorOutline(threadId),
        (read) => read.topics.find((topic) => topic.id === eigen!.id)?.lessons,
      );
      assert.equal((yield* learning.tutorOutline(threadId)).lessonTopicId, eigen!.id);
      // The tutor counts a lesson once its thread exists, as the learner's notebook does.
      assert.equal(yield* lessonsOnEigen, 0);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
        thread_id: threadId,
        project_id: projectId,
        title: "Eigenvectors",
        default_provider: "claude",
        runtime_mode: "auto",
        interaction_mode: "default",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
        payload_json: "{}",
      })}`;
      assert.equal(yield* lessonsOnEigen, 1);
      const elsewhere = yield* learning
        .setLessonTopic({ projectId: ProjectId.make("project-other"), threadId, topicId: null })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(elsewhere));

      // A lesson moved to another notebook stops counting here.
      const moveTo = (to: ProjectId) =>
        sql`UPDATE orchestration_v2_projection_threads SET project_id = ${to} WHERE thread_id = ${threadId}`;
      yield* moveTo(ProjectId.make("project-other"));
      assert.isNull((yield* learning.tutorOutline(threadId)).lessonTopicId);
      assert.equal(yield* lessonsOnEigen, 0);
      yield* moveTo(projectId);

      yield* learning.markTopicLearned(threadId);
      assert.equal((yield* learning.getThreadState(threadId)).topic?.status, "learned");

      // Removing the topic leaves the lesson loose rather than deleting it.
      yield* learning.editOutline({ projectId, ops: [{ type: "remove", topicId: eigen!.id }] });
      assert.isNull((yield* learning.getThreadState(threadId)).topic);
    }).pipe(Effect.provide(makeLayer(sent)));
  }),
);

it.effect(
  "ends a notebook's first session at its outline unless it planned or was turned down",
  () =>
    Effect.gen(function* () {
      const sent = yield* Ref.make<ReadonlyArray<string>>([]);
      const draft = {
        ops: [{ type: "add" as const, title: "Vectors" }],
        reason: "A first outline.",
      };

      yield* Effect.gen(function* () {
        const learning = yield* LearningService.LearningService;
        assert.isTrue((yield* learning.tutorOutline(threadId)).needsOutline);
        const first = yield* learning.proposeOutline(threadId, draft);
        assert.isTrue(first.firstOutline);
        // Dismissed: the tutor is not sent to draft again, but a draft the learner asks for
        // still leads to the notebook.
        yield* learning.resolveProposal({ proposalId: first.proposalId, accept: false });
        assert.isFalse((yield* learning.tutorOutline(threadId)).needsOutline);
        assert.isTrue((yield* learning.proposeOutline(threadId, draft)).firstOutline);
      }).pipe(Effect.provide(makeLayer(sent)));

      // A session that planned is teaching: its outline suggestion does not end it.
      yield* Effect.gen(function* () {
        const learning = yield* LearningService.LearningService;
        yield* learning.setPlan(threadId, { nodes: [{ id: "a", title: "A" }], edges: [] });
        assert.isFalse((yield* learning.tutorOutline(threadId)).needsOutline);
        assert.isFalse((yield* learning.proposeOutline(threadId, draft)).firstOutline);
      }).pipe(Effect.provide(makeLayer(sent)));
    }),
);

it.effect("lets the tutor name only a new notebook, keeping an icon the learner chose", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const named = Effect.fn(function* (notebook: {
      readonly title: string;
      readonly projectIcon?: unknown;
    }) {
      const projectUpdates = yield* Ref.make<ReadonlyArray<ProjectService.ProjectUpdateInput>>([]);
      return yield* Effect.gen(function* () {
        const learning = yield* LearningService.LearningService;
        const needsName = (yield* learning.tutorOutline(threadId)).needsName;
        const tooLong = yield* learning.nameNotebook(threadId, "x".repeat(41)).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(tooLong));
        const named = yield* learning.nameNotebook(threadId, "  Azure AZ-900 ").pipe(Effect.exit);
        const [update] = yield* Ref.get(projectUpdates);
        return {
          needsName,
          named: Exit.isSuccess(named),
          title: update?.title,
          projectIcon: update?.projectIcon,
        };
      }).pipe(Effect.provide(makeLayer(sent, { notebook, projectUpdates })));
    });

    const fresh = yield* named({ title: NEW_NOTEBOOK_TITLE });
    assert.isTrue(fresh.needsName);
    assert.equal(fresh.title, "Azure AZ-900");
    assert.deepInclude(fresh.projectIcon, { kind: "monogram", text: "AA" });

    const chosen = yield* named({
      title: NEW_NOTEBOOK_TITLE,
      projectIcon: { kind: "emoji", emoji: "☁️" },
    });
    assert.equal(chosen.title, "Azure AZ-900");
    assert.isUndefined(chosen.projectIcon);

    // The learner owns a name they gave; the tutor cannot replace it.
    const learnerNamed = yield* named({ title: "Cloud" });
    assert.isFalse(learnerNamed.needsName);
    assert.isFalse(learnerNamed.named);
    assert.isUndefined(learnerNamed.title);
  }),
);

it.effect("keeps sessions outside any notebook out of outlines", () =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const learning = yield* LearningService.LearningService;
      assert.isFalse((yield* learning.tutorOutline(threadId)).inNotebook);
      const proposed = yield* learning
        .proposeOutline(threadId, { ops: [{ type: "add", title: "Vectors" }], reason: "x" })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(proposed));
    }).pipe(Effect.provide(makeLayer(sent, { scratch: true })));
  }),
);
