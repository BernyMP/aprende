import {
  CommandId,
  LEARNING_CHECK_MAX_OUTPUT_BYTES,
  LEARNING_CHECK_TIMEOUT_SECONDS,
  LearningAnswer,
  LearningAssessment,
  LearningError,
  LearningPlan,
  LearningProblemAttempt,
  LearningProblemConclusion,
  LearningProblemTarget,
  LearningProblemWorkspace,
  MessageId,
  type LearningAnswerInput,
  type LearningAnswerResult,
  type LearningChain,
  type LearningCheckRun,
  type LearningKnowledge,
  type LearningKnowledgeView,
  type LearningMissType,
  type LearningProblemOutcome,
  type LearningProblemResult,
  type LearningProblemView,
  type LearningPlanEdge,
  type LearningPlanNode,
  type LearningProposition,
  type LearningQuestionView,
  type LearningRevealHintInput,
  type LearningRunCheckInput,
  type LearningSetTutorPromptInput,
  type LearningStrand,
  type LearningSubmitSolutionInput,
  type LearningThreadState,
  type LearningTutorPrompt,
  type ProjectId,
  type ThreadId,
} from "@aprende/contracts";
import * as HostProcess from "@aprende/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { ServerConfig } from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  answerProblem,
  conclusionProblem,
  formatAnswerMessage,
  formatSolutionMessage,
  gradeAnswer,
  planProblem,
  practiceFolderName,
  problemDraftProblem,
  questionDraftProblem,
  shuffleOptions,
  solutionProblem,
  type ProblemDraft,
  type QuestionDraft,
  type StoredProblem,
  type StoredQuestion,
  type WorkspaceDraft,
} from "./learningLogic.ts";
import { DEFAULT_TUTOR_PROMPT, readTutorPrompt, writeTutorPrompt } from "./tutorPrompt.ts";

export interface GraphRecordInput {
  readonly propositions: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly statement: string;
    readonly sameAs?: string | undefined;
  }>;
  readonly chains: ReadonlyArray<{
    readonly premises: ReadonlyArray<string>;
    readonly conclusion: string;
  }>;
}

export interface ConcludeProblemInput {
  readonly problemId: string;
  readonly outcome: LearningProblemOutcome;
  readonly verdict: string;
  readonly missType?: LearningMissType | undefined;
  readonly retest: boolean;
}

export class LearningService extends Context.Service<
  LearningService,
  {
    readonly askQuestion: (
      threadId: ThreadId,
      draft: QuestionDraft,
    ) => Effect.Effect<{ readonly questionId: string }, LearningError>;
    readonly poseProblem: (
      threadId: ThreadId,
      draft: ProblemDraft,
    ) => Effect.Effect<{ readonly problemId: string }, LearningError>;
    readonly concludeProblem: (
      threadId: ThreadId,
      input: ConcludeProblemInput,
    ) => Effect.Effect<void, LearningError>;
    readonly finishMeasuring: (
      threadId: ThreadId,
      input: {
        readonly goal: string;
        readonly strands: ReadonlyArray<Omit<LearningStrand, never>>;
        readonly summary?: string | undefined;
      },
    ) => Effect.Effect<void, LearningError>;
    readonly setPlan: (
      threadId: ThreadId,
      input: {
        readonly nodes: ReadonlyArray<LearningPlanNode>;
        readonly edges: ReadonlyArray<LearningPlanEdge>;
      },
    ) => Effect.Effect<{ readonly version: number }, LearningError>;
    readonly searchGraph: (input: {
      readonly query?: string | undefined;
      readonly limit?: number | undefined;
    }) => Effect.Effect<LearningKnowledge, LearningError>;
    readonly recordGraph: (
      threadId: ThreadId,
      input: GraphRecordInput,
    ) => Effect.Effect<
      { readonly propositions: ReadonlyArray<{ readonly key: string; readonly id: string }> },
      LearningError
    >;
    readonly getThreadState: (
      threadId: ThreadId,
    ) => Effect.Effect<LearningThreadState, LearningError>;
    readonly subscribeThread: (
      threadId: ThreadId,
    ) => Stream.Stream<LearningThreadState, LearningError>;
    readonly answer: (
      input: LearningAnswerInput,
    ) => Effect.Effect<LearningAnswerResult, LearningError>;
    readonly revealHint: (
      input: LearningRevealHintInput,
    ) => Effect.Effect<LearningProblemResult, LearningError>;
    readonly submitSolution: (
      input: LearningSubmitSolutionInput,
    ) => Effect.Effect<LearningProblemResult, LearningError>;
    /** Runs a coding problem's check command in its practice folder, as the learner's own terminal would. */
    readonly runCheck: (
      input: LearningRunCheckInput,
    ) => Effect.Effect<LearningCheckRun, LearningError>;
    /** The absolute path of a problem's practice folder; fails when it has none or it is gone. */
    readonly practiceFolder: (input: LearningRunCheckInput) => Effect.Effect<string, LearningError>;
    readonly getTutorPrompt: () => Effect.Effect<LearningTutorPrompt, LearningError>;
    readonly setTutorPrompt: (
      input: LearningSetTutorPromptInput,
    ) => Effect.Effect<LearningTutorPrompt, LearningError>;
    readonly getKnowledge: () => Effect.Effect<LearningKnowledgeView, LearningError>;
  }
>()("aprende/learning/LearningService") {}

interface QuestionRow {
  readonly question_id: string;
  readonly thread_id: string;
  readonly purpose: string;
  readonly format: string;
  readonly prompt: string;
  readonly options_json: string;
  readonly correct_options_json: string;
  readonly allow_multiple: number;
  readonly model_answer: string | null;
  readonly explanation: string | null;
  readonly plan_node_id: string | null;
  readonly status: string;
  readonly answer_json: string | null;
  readonly created_at: string;
}

interface ProblemRow {
  readonly problem_id: string;
  readonly thread_id: string;
  readonly mode: string;
  readonly statement: string;
  readonly targets_json: string;
  readonly model_solution: string;
  readonly hints_json: string;
  readonly hints_used: number;
  readonly retest_of: string | null;
  readonly status: string;
  readonly attempt_json: string | null;
  readonly conclusion_json: string | null;
  readonly workspace_json: string | null;
  readonly created_at: string;
}

interface PropositionRow {
  readonly proposition_id: string;
  readonly name: string;
  readonly statement: string;
  readonly created_at: string;
  readonly source_thread_ids: string | null;
}

interface SessionRow {
  readonly thread_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly created_at: string;
}

interface ChainRow {
  readonly chain_id: string;
  readonly premises_json: string;
  readonly conclusion_id: string;
  readonly thread_id: string;
  readonly created_at: string;
}

const StringsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const IntsJson = Schema.fromJsonString(Schema.Array(Schema.Int));
const decodeStrings = Schema.decodeUnknownSync(StringsJson);
const encodeStrings = Schema.encodeSync(StringsJson);
const decodeInts = Schema.decodeUnknownSync(IntsJson);
const encodeInts = Schema.encodeSync(IntsJson);
const decodeAnswer = Schema.decodeUnknownSync(Schema.fromJsonString(LearningAnswer));
const encodeAnswer = Schema.encodeSync(Schema.fromJsonString(LearningAnswer));
const decodePlan = Schema.decodeUnknownSync(Schema.fromJsonString(LearningPlan));
const encodePlan = Schema.encodeSync(Schema.fromJsonString(LearningPlan));
const decodeAssessment = Schema.decodeUnknownSync(Schema.fromJsonString(LearningAssessment));
const encodeAssessment = Schema.encodeSync(Schema.fromJsonString(LearningAssessment));
const TargetsJson = Schema.fromJsonString(Schema.Array(LearningProblemTarget));
const decodeTargets = Schema.decodeUnknownSync(TargetsJson);
const encodeTargets = Schema.encodeSync(TargetsJson);
const decodeAttempt = Schema.decodeUnknownSync(Schema.fromJsonString(LearningProblemAttempt));
const encodeAttempt = Schema.encodeSync(Schema.fromJsonString(LearningProblemAttempt));
const decodeConclusion = Schema.decodeUnknownSync(Schema.fromJsonString(LearningProblemConclusion));
const encodeConclusion = Schema.encodeSync(Schema.fromJsonString(LearningProblemConclusion));
const decodeWorkspace = Schema.decodeUnknownSync(Schema.fromJsonString(LearningProblemWorkspace));
const encodeWorkspace = Schema.encodeSync(Schema.fromJsonString(LearningProblemWorkspace));

const fail = (message: string, cause?: unknown) =>
  new LearningError(cause === undefined ? { message } : { message, cause });

const storedQuestion = (row: QuestionRow): StoredQuestion => ({
  id: row.question_id,
  purpose: row.purpose as StoredQuestion["purpose"],
  format: row.format as StoredQuestion["format"],
  prompt: row.prompt,
  options: decodeStrings(row.options_json),
  correctOptions: decodeInts(row.correct_options_json),
  allowMultiple: row.allow_multiple === 1,
  modelAnswer: row.model_answer,
  explanation: row.explanation,
});

const questionView = (row: QuestionRow): LearningQuestionView => {
  const question = storedQuestion(row);
  const answer = row.answer_json === null ? null : decodeAnswer(row.answer_json);
  return {
    id: question.id,
    threadId: row.thread_id as ThreadId,
    purpose: question.purpose,
    format: question.format,
    prompt: question.prompt,
    options: question.options,
    allowMultiple: question.allowMultiple,
    planNodeId: row.plan_node_id,
    status: row.status as LearningQuestionView["status"],
    createdAt: row.created_at,
    answer,
    // The committed answer stays on the server until the learner has answered.
    reveal:
      row.status === "answered"
        ? {
            correctOptions: question.correctOptions,
            modelAnswer: question.modelAnswer,
            explanation: question.explanation,
          }
        : null,
  };
};

const storedProblem = (row: ProblemRow): StoredProblem => ({
  id: row.problem_id,
  mode: row.mode as StoredProblem["mode"],
  statement: row.statement,
  targets: decodeTargets(row.targets_json),
  hintCount: decodeStrings(row.hints_json).length,
  retestOf: row.retest_of,
  workspace: row.workspace_json === null ? null : decodeWorkspace(row.workspace_json),
});

const problemView = (row: ProblemRow): LearningProblemView => {
  const problem = storedProblem(row);
  const hints = decodeStrings(row.hints_json);
  // The solution and the hints not yet asked for stay on the server until the tutor concludes.
  const concluded = row.status === "concluded";
  return {
    id: problem.id,
    threadId: row.thread_id as ThreadId,
    mode: problem.mode,
    statement: problem.statement,
    targets: problem.targets,
    retestOf: problem.retestOf,
    status: row.status as LearningProblemView["status"],
    hints: concluded ? hints : hints.slice(0, row.hints_used),
    hintCount: hints.length,
    hintsUsed: row.hints_used,
    createdAt: row.created_at,
    attempt: row.attempt_json === null ? null : decodeAttempt(row.attempt_json),
    conclusion: row.conclusion_json === null ? null : decodeConclusion(row.conclusion_json),
    modelSolution: concluded ? row.model_solution : null,
    workspace: problem.workspace,
  };
};

/** Collects output up to a byte cap, remembering whether more arrived. */
const cappedOutput = (maxBytes: number) => {
  const chunks: Array<Uint8Array> = [];
  let bytes = 0;
  let truncated = false;
  return {
    push: (chunk: Uint8Array) => {
      const room = maxBytes - bytes;
      if (chunk.byteLength > room) truncated = true;
      if (room <= 0) return;
      const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
      chunks.push(kept);
      bytes += kept.byteLength;
    },
    read: () => ({ output: Buffer.concat(chunks).toString("utf8"), truncated }),
  };
};

// stderr joins stdout in the shell, so the learner reads both in the order they were written.
const checkInvocation = (platform: NodeJS.Platform, command: string) =>
  platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", `(${command}) 2>&1`] }
    : { command: "/bin/sh", args: ["-c", `exec 2>&1\n${command}`] };

const propositionView = (row: PropositionRow): LearningProposition => ({
  id: row.proposition_id,
  name: row.name,
  statement: row.statement,
  createdAt: row.created_at,
  sourceThreadIds: (row.source_thread_ids ?? "")
    .split(",")
    .filter((id) => id.length > 0) as Array<ThreadId>,
});

const chainView = (row: ChainRow): LearningChain => ({
  id: row.chain_id,
  premises: decodeStrings(row.premises_json),
  conclusion: row.conclusion_id,
  sourceThreadId: row.thread_id as ThreadId,
  createdAt: row.created_at,
});

export const layer = Layer.effect(
  LearningService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const random = yield* SecureRandom.SecureRandom;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const serverConfig = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const changes = yield* PubSub.unbounded<ThreadId>();
    const promptLocation = { fileSystem, path, stateDir: serverConfig.stateDir };

    const newId = (prefix: string) =>
      random.uuidV4().pipe(
        Effect.orDie,
        Effect.map((id) => `${prefix}-${id}`),
      );
    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const dbError = (message: string) => (cause: unknown) => fail(message, cause);
    const changed = (threadId: ThreadId) => PubSub.publish(changes, threadId);

    const readPlan = (threadId: ThreadId) =>
      sql<{
        plan_json: string;
      }>`SELECT plan_json FROM learning_plans WHERE thread_id = ${threadId}`.pipe(
        Effect.map((rows) => (rows[0] === undefined ? null : decodePlan(rows[0].plan_json))),
      );

    const getThreadState: LearningService["Service"]["getThreadState"] = Effect.fn(
      "LearningService.getThreadState",
    )(
      function* (threadId) {
        const rows = yield* sql<QuestionRow>`
        SELECT * FROM learning_questions WHERE thread_id = ${threadId} ORDER BY created_at, rowid
      `;
        const assessmentRows = yield* sql<{ assessment_json: string }>`
        SELECT assessment_json FROM learning_assessments WHERE thread_id = ${threadId}
      `;
        const problemRows = yield* sql<ProblemRow>`
        SELECT * FROM learning_problems WHERE thread_id = ${threadId} ORDER BY created_at, rowid
      `;
        const plan = yield* readPlan(threadId);
        const assessment =
          assessmentRows[0] === undefined
            ? null
            : decodeAssessment(assessmentRows[0].assessment_json);
        const questions = rows.map(questionView);
        const currentNodeId =
          questions.findLast((question) => question.planNodeId !== null)?.planNodeId ?? null;
        return {
          threadId,
          phase: plan !== null ? "teach" : assessment !== null ? "plan" : "measure",
          questions,
          problems: problemRows.map(problemView),
          assessment,
          plan,
          currentNodeId,
        } satisfies LearningThreadState;
      },
      Effect.mapError(dbError("Could not read the learning state.")),
    );

    const subscribeThread: LearningService["Service"]["subscribeThread"] = (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading so a change between the two is not lost.
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(getThreadState(threadId)),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((changedThreadId) => changedThreadId === threadId),
              Stream.mapEffect(() => getThreadState(threadId)),
            ),
          );
        }),
      );

    // One card waits for the learner at a time: a new question or problem replaces an open one.
    const skipOpenItems = (threadId: ThreadId) =>
      Effect.all(
        [
          sql`UPDATE learning_questions SET status = 'skipped' WHERE thread_id = ${threadId} AND status = 'open'`,
          sql`UPDATE learning_problems SET status = 'skipped' WHERE thread_id = ${threadId} AND status = 'open'`,
        ],
        { discard: true },
      );

    const sendToTutor = Effect.fn("LearningService.sendToTutor")(function* (
      threadId: ThreadId,
      idPrefix: string,
      text: string,
    ) {
      const shell = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(dbError("Could not find the session.")));
      if (shell === null) return yield* fail("Could not find the session.");
      const sendId = yield* newId(idPrefix);
      yield* threads
        .sendToThread({
          projectId: shell.projectId,
          commandId: CommandId.make(sendId),
          threadId,
          messageId: MessageId.make(sendId),
          text,
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError(dbError("Could not send it to the tutor.")));
    });

    const askQuestion: LearningService["Service"]["askQuestion"] = Effect.fn(
      "LearningService.askQuestion",
    )(function* (threadId, draft) {
      const plan = yield* readPlan(threadId).pipe(
        Effect.mapError(dbError("Could not read the plan.")),
      );
      const problem = questionDraftProblem(
        draft,
        plan === null ? null : new Set(plan.nodes.map((node) => node.id)),
      );
      if (problem !== undefined) return yield* fail(problem);
      const questionId = yield* newId("q");
      const createdAt = yield* nowIso;
      const options = (draft.options ?? []).map((option) => option.trim());
      const graded = draft.purpose !== "goal" && draft.format === "choice";
      const arranged = graded
        ? shuffleOptions(options, draft.correctOptions ?? [], questionId)
        : { options, correctOptions: draft.correctOptions ?? [] };
      yield* sql
        .withTransaction(
          skipOpenItems(threadId).pipe(
            Effect.andThen(
              sql`INSERT INTO learning_questions ${sql.insert({
                question_id: questionId,
                thread_id: threadId,
                purpose: draft.purpose,
                format: draft.format,
                prompt: draft.question.trim(),
                options_json: encodeStrings(arranged.options),
                correct_options_json: encodeInts(arranged.correctOptions),
                allow_multiple: draft.allowMultiple === true ? 1 : 0,
                model_answer: draft.modelAnswer?.trim() || null,
                explanation: draft.explanation?.trim() || null,
                plan_node_id: draft.planNodeId ?? null,
                status: "open",
                answer_json: null,
                created_at: createdAt,
              })}`,
            ),
          ),
        )
        .pipe(Effect.mapError(dbError("Could not save the question.")));
      yield* changed(threadId);
      return { questionId };
    });

    const finishMeasuring: LearningService["Service"]["finishMeasuring"] = Effect.fn(
      "LearningService.finishMeasuring",
    )(function* (threadId, input) {
      if (input.strands.length === 0) return yield* fail("Describe at least one strand.");
      const assessment: LearningAssessment = {
        goal: input.goal.trim(),
        strands: input.strands,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        updatedAt: yield* nowIso,
      };
      yield* sql`
        INSERT INTO learning_assessments (thread_id, assessment_json)
        VALUES (${threadId}, ${encodeAssessment(assessment)})
        ON CONFLICT (thread_id) DO UPDATE SET assessment_json = excluded.assessment_json
      `.pipe(Effect.mapError(dbError("Could not save the assessment.")));
      yield* changed(threadId);
    });

    const setPlan: LearningService["Service"]["setPlan"] = Effect.fn("LearningService.setPlan")(
      function* (threadId, input) {
        const problem = planProblem(input.nodes, input.edges);
        if (problem !== undefined) return yield* fail(problem);
        const previous = yield* readPlan(threadId).pipe(
          Effect.mapError(dbError("Could not read the plan.")),
        );
        const plan: LearningPlan = {
          nodes: input.nodes,
          edges: input.edges,
          version: (previous?.version ?? 0) + 1,
          updatedAt: yield* nowIso,
        };
        yield* sql`
          INSERT INTO learning_plans (thread_id, plan_json)
          VALUES (${threadId}, ${encodePlan(plan)})
          ON CONFLICT (thread_id) DO UPDATE SET plan_json = excluded.plan_json
        `.pipe(Effect.mapError(dbError("Could not save the plan.")));
        yield* changed(threadId);
        return { version: plan.version };
      },
    );

    const listPropositions = Effect.fn("LearningService.listPropositions")(function* (where: {
      readonly words: ReadonlyArray<string>;
      readonly limit: number;
    }) {
      const rows = yield* sql<PropositionRow>`
          SELECT p.proposition_id, p.name, p.statement, p.created_at,
            (SELECT group_concat(s.thread_id) FROM learning_proposition_sources s
              WHERE s.proposition_id = p.proposition_id) AS source_thread_ids
          FROM learning_propositions p
          ORDER BY p.created_at DESC
        `;
      const words = where.words.map((word) => word.toLowerCase());
      return rows
        .filter((row) => {
          const haystack = `${row.name} ${row.statement}`.toLowerCase();
          return words.every((word) => haystack.includes(word));
        })
        .slice(0, where.limit)
        .map(propositionView);
    });

    const chainsAmong = (ids: ReadonlySet<string> | null) =>
      sql<ChainRow>`SELECT * FROM learning_chains ORDER BY created_at`.pipe(
        Effect.map((rows) =>
          rows.map(chainView).filter((chain) => ids === null || ids.has(chain.conclusion)),
        ),
      );

    const searchGraph: LearningService["Service"]["searchGraph"] = Effect.fn(
      "LearningService.searchGraph",
    )(
      function* (input) {
        const words = (input.query ?? "").split(/\s+/).filter((word) => word.length > 0);
        const matches = yield* listPropositions({ words, limit: input.limit ?? 50 });
        const chains = yield* chainsAmong(new Set(matches.map((entry) => entry.id)));
        // Chains name their premises by id; return those propositions so the tutor can read them.
        const found = new Set(matches.map((entry) => entry.id));
        const premiseIds = new Set(chains.flatMap((chain) => chain.premises));
        const premises = (yield* listPropositions({
          words: [],
          limit: Number.MAX_SAFE_INTEGER,
        })).filter((entry) => premiseIds.has(entry.id) && !found.has(entry.id));
        return { propositions: [...matches, ...premises], chains };
      },
      Effect.mapError(dbError("Could not search the knowledge graph.")),
    );

    const recordGraph: LearningService["Service"]["recordGraph"] = Effect.fn(
      "LearningService.recordGraph",
    )(function* (threadId, input) {
      const createdAt = yield* nowIso;
      const keys = new Map<string, string>();
      const existing = new Set(
        (yield* sql<{
          proposition_id: string;
        }>`SELECT proposition_id FROM learning_propositions`.pipe(
          Effect.mapError(dbError("Could not read the knowledge graph.")),
        )).map((row) => row.proposition_id),
      );
      const inserts: Array<Effect.Effect<unknown, SqlError>> = [];
      for (const entry of input.propositions) {
        if (keys.has(entry.key)) return yield* fail(`Key "${entry.key}" appears twice.`);
        if (entry.sameAs !== undefined) {
          if (!existing.has(entry.sameAs))
            return yield* fail(`sameAs "${entry.sameAs}" is not a known proposition id.`);
          keys.set(entry.key, entry.sameAs);
        } else {
          const id = yield* newId("p");
          keys.set(entry.key, id);
          inserts.push(
            sql`INSERT INTO learning_propositions ${sql.insert({
              proposition_id: id,
              name: entry.name.trim(),
              statement: entry.statement.trim(),
              created_at: createdAt,
            })}`,
          );
        }
        inserts.push(sql`
          INSERT OR IGNORE INTO learning_proposition_sources (proposition_id, thread_id, created_at)
          VALUES (${keys.get(entry.key)!}, ${threadId}, ${createdAt})
        `);
      }
      const resolve = (reference: string) =>
        keys.get(reference) ?? (existing.has(reference) ? reference : undefined);
      for (const chain of input.chains) {
        const premises = chain.premises.map(resolve);
        const conclusion = resolve(chain.conclusion);
        if (
          premises.length === 0 ||
          premises.some((id) => id === undefined) ||
          conclusion === undefined
        )
          return yield* fail(
            "Chains must name premises and a conclusion by a key in this call or an existing proposition id.",
          );
        inserts.push(
          sql`INSERT INTO learning_chains ${sql.insert({
            chain_id: yield* newId("c"),
            premises_json: encodeStrings(premises as Array<string>),
            conclusion_id: conclusion,
            thread_id: threadId,
            created_at: createdAt,
          })}`,
        );
      }
      yield* sql
        .withTransaction(Effect.all(inserts, { discard: true }))
        .pipe(Effect.mapError(dbError("Could not save to the knowledge graph.")));
      return { propositions: [...keys].map(([key, id]) => ({ key, id })) };
    });

    const answer: LearningService["Service"]["answer"] = Effect.fn("LearningService.answer")(
      function* (input) {
        const rows = yield* sql<QuestionRow>`
          SELECT * FROM learning_questions WHERE question_id = ${input.questionId}
        `.pipe(Effect.mapError(dbError("Could not read the question.")));
        const row = rows[0];
        if (row === undefined || row.thread_id !== input.threadId)
          return yield* fail("That question does not exist in this session.");
        if (row.status !== "open")
          return yield* fail("That question was already answered or replaced.");
        const question = storedQuestion(row);
        const problem = answerProblem(question, input);
        if (problem !== undefined) return yield* fail(problem);
        const recorded: LearningAnswer = {
          selectedOptions: input.dontKnow ? [] : [...input.selectedOptions].toSorted(),
          ...(input.text?.trim() ? { text: input.text.trim() } : {}),
          dontKnow: input.dontKnow,
          ...(input.confidence === undefined || input.dontKnow
            ? {}
            : { confidence: input.confidence }),
          ...(input.thinking?.trim() ? { thinking: input.thinking.trim() } : {}),
          correct: gradeAnswer(question, input.selectedOptions, input.dontKnow),
          answeredAt: yield* nowIso,
        };
        const claimed = yield* sql<{ question_id: string }>`
          UPDATE learning_questions SET status = 'answered', answer_json = ${encodeAnswer(recorded)}
          WHERE question_id = ${row.question_id} AND status = 'open'
          RETURNING question_id
        `.pipe(Effect.mapError(dbError("Could not save the answer.")));
        // Two submits can race; only the one that flipped the row sends the message.
        if (claimed.length === 0) return yield* fail("That question was already answered.");
        const reopen = sql`
          UPDATE learning_questions SET status = 'open', answer_json = NULL WHERE question_id = ${row.question_id}
        `.pipe(Effect.ignore);
        yield* sendToTutor(
          input.threadId,
          "learning-answer",
          formatAnswerMessage(question, recorded),
        ).pipe(
          // Any ending, defects and interruption included, leaves the question answerable again.
          Effect.onError(() => reopen),
        );
        yield* changed(input.threadId);
        return {
          question: questionView({
            ...row,
            status: "answered",
            answer_json: encodeAnswer(recorded),
          }),
        };
      },
    );

    const readProblem = (threadId: ThreadId, problemId: string) =>
      sql<ProblemRow>`SELECT * FROM learning_problems WHERE problem_id = ${problemId}`.pipe(
        Effect.mapError(dbError("Could not read the problem.")),
        Effect.flatMap((rows) =>
          rows[0] === undefined || rows[0].thread_id !== threadId
            ? Effect.fail(fail("That problem does not exist in this session."))
            : Effect.succeed(rows[0]),
        ),
      );

    // The folder the session's CLI runs in, which practice folders live under.
    const sessionRoot = Effect.fn("LearningService.sessionRoot")(function* (threadId: ThreadId) {
      const shell = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(dbError("Could not find the session.")));
      if (shell === null) return yield* fail("Could not find the session.");
      if (shell.worktreePath !== null) return shell.worktreePath;
      const project = yield* projects
        .getById(shell.projectId)
        .pipe(Effect.mapError(dbError("Could not find the session's project.")));
      if (Option.isNone(project)) return yield* fail("Could not find the session's project.");
      return project.value.workspaceRoot;
    });

    const createWorkspace = Effect.fn("LearningService.createWorkspace")(function* (
      threadId: ThreadId,
      problemId: string,
      name: string,
      draft: WorkspaceDraft,
    ) {
      const root = yield* sessionRoot(threadId);
      const folder = `practice/${practiceFolderName(name, problemId)}`;
      const absolute = path.join(root, ...folder.split("/"));
      yield* Effect.gen(function* () {
        const practice = path.join(root, "practice");
        yield* fileSystem.makeDirectory(practice, { recursive: true });
        // A symlinked practice folder would put starter files outside the session folder.
        const realRoot = yield* fileSystem.realPath(root);
        if ((yield* fileSystem.realPath(practice)) !== path.join(realRoot, "practice"))
          return yield* fail(`${folder} must stay inside the session folder.`);
        // Neither the folder nor its files may exist yet, so nothing of the learner's is overwritten.
        yield* fileSystem.makeDirectory(absolute);
        for (const file of draft.files) {
          const target = path.join(absolute, ...file.path.split("/"));
          yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
          yield* fileSystem.writeFileString(target, file.contents, { flag: "wx" });
        }
      }).pipe(Effect.mapError(dbError(`Could not create the practice folder ${folder}.`)));
      const workspace: LearningProblemWorkspace = {
        folder,
        files: draft.files.map((file) => file.path),
        checkCommand: draft.checkCommand?.trim() || null,
      };
      return { workspace, absolute };
    });

    // Overlapping checks in one folder can fail correct work, so each problem runs one at a time.
    const checkLocks = new Map<string, Semaphore.Semaphore>();
    const checkLock = (problemId: string) => {
      const existing = checkLocks.get(problemId);
      if (existing !== undefined) return existing;
      const lock = Semaphore.makeUnsafe(1);
      checkLocks.set(problemId, lock);
      return lock;
    };

    const existingWorkspaceFolder = Effect.fn("LearningService.existingWorkspaceFolder")(function* (
      threadId: ThreadId,
      workspace: LearningProblemWorkspace,
    ) {
      const absolute = path.join(yield* sessionRoot(threadId), ...workspace.folder.split("/"));
      return (yield* fileSystem.exists(absolute).pipe(Effect.orElseSucceed(() => false)))
        ? absolute
        : null;
    });

    const runWorkspaceCheck = Effect.fn("LearningService.runWorkspaceCheck")(function* (
      threadId: ThreadId,
      problemId: string,
      workspace: LearningProblemWorkspace & { readonly checkCommand: string },
    ) {
      return yield* Semaphore.withPermit(
        checkLock(problemId),
        runWorkspaceCheckUnlocked(threadId, workspace),
      );
    });

    const runWorkspaceCheckUnlocked = Effect.fn("LearningService.runWorkspaceCheckUnlocked")(
      function* (
        threadId: ThreadId,
        workspace: LearningProblemWorkspace & { readonly checkCommand: string },
      ) {
        const failed = (output: string): LearningCheckRun => ({
          exitCode: null,
          output,
          truncated: false,
          timedOut: false,
        });
        const cwd = yield* existingWorkspaceFolder(threadId, workspace);
        if (cwd === null) return failed(`The practice folder ${workspace.folder} is gone.`);
        const output = cappedOutput(LEARNING_CHECK_MAX_OUTPUT_BYTES);
        const result = yield* processRunner
          .run({
            ...checkInvocation(yield* HostProcess.Platform, workspace.checkCommand),
            cwd,
            // Unbuffered, so Python's prints and tracebacks arrive in order and survive a timeout.
            env: { PYTHONUNBUFFERED: "1" },
            timeout: `${LEARNING_CHECK_TIMEOUT_SECONDS} seconds`,
            timeoutBehavior: "timedOutResult",
            maxOutputBytes: LEARNING_CHECK_MAX_OUTPUT_BYTES,
            outputMode: "truncate",
            onStdoutChunk: output.push,
          })
          .pipe(Effect.result);
        if (result._tag === "Failure") return failed(result.failure.message);
        const run = result.success;
        if (run.stderr.length > 0) output.push(Buffer.from(run.stderr));
        return {
          exitCode: run.timedOut || run.code === null ? null : Number(run.code),
          timedOut: run.timedOut,
          ...output.read(),
        } satisfies LearningCheckRun;
      },
    );

    const poseProblem: LearningService["Service"]["poseProblem"] = Effect.fn(
      "LearningService.poseProblem",
    )(function* (threadId, draft) {
      const problem = problemDraftProblem(draft);
      if (problem !== undefined) return yield* fail(problem);
      const existing = yield* sql<{ problem_id: string; status: string }>`
        SELECT problem_id, status FROM learning_problems WHERE thread_id = ${threadId}
      `.pipe(Effect.mapError(dbError("Could not read the problems.")));
      const awaiting = existing.find((row) => row.status === "submitted");
      if (awaiting !== undefined)
        return yield* fail(
          `The learner's work on problem ${awaiting.problem_id} is waiting for your verdict. Call conclude_problem first.`,
        );
      if (
        draft.retestOf !== undefined &&
        !existing.some((row) => row.problem_id === draft.retestOf)
      )
        return yield* fail(`retestOf "${draft.retestOf}" is not a problem in this session.`);
      const names = new Map(
        (yield* sql<{ proposition_id: string; name: string }>`
          SELECT proposition_id, name FROM learning_propositions
        `.pipe(Effect.mapError(dbError("Could not read the knowledge graph.")))).map((row) => [
          row.proposition_id,
          row.name,
        ]),
      );
      const targets = draft.targets.map((target) => {
        const name = names.get(target.trim());
        return name === undefined
          ? { name: target.trim(), propositionId: null }
          : { name, propositionId: target.trim() };
      });
      const problemId = yield* newId("prob");
      const createdAt = yield* nowIso;
      const created =
        draft.workspace === undefined
          ? null
          : yield* createWorkspace(
              threadId,
              problemId,
              draft.workspace.name ?? targets[0]!.name,
              draft.workspace,
            );
      yield* sql
        .withTransaction(
          skipOpenItems(threadId).pipe(
            Effect.andThen(
              sql`INSERT INTO learning_problems ${sql.insert({
                problem_id: problemId,
                thread_id: threadId,
                mode: draft.mode,
                statement: draft.statement.trim(),
                targets_json: encodeTargets(targets),
                model_solution: draft.modelSolution.trim(),
                hints_json: encodeStrings(draft.hints.map((hint) => hint.trim())),
                hints_used: 0,
                retest_of: draft.retestOf ?? null,
                status: "open",
                attempt_json: null,
                conclusion_json: null,
                workspace_json: created === null ? null : encodeWorkspace(created.workspace),
                created_at: createdAt,
              })}`,
            ),
          ),
        )
        .pipe(
          Effect.mapError(dbError("Could not save the problem.")),
          Effect.onError(() =>
            created === null
              ? Effect.void
              : fileSystem.remove(created.absolute, { recursive: true }).pipe(Effect.ignore),
          ),
        );
      yield* changed(threadId);
      return { problemId };
    });

    const revealHint: LearningService["Service"]["revealHint"] = Effect.fn(
      "LearningService.revealHint",
    )(function* (input) {
      const revealed = yield* sql<ProblemRow>`
        UPDATE learning_problems SET hints_used = hints_used + 1
        WHERE problem_id = ${input.problemId} AND thread_id = ${input.threadId} AND status = 'open'
          AND hints_used < json_array_length(hints_json)
        RETURNING *
      `.pipe(Effect.mapError(dbError("Could not reveal the hint.")));
      const row = revealed[0];
      if (row === undefined) {
        const current = yield* readProblem(input.threadId, input.problemId);
        return yield* fail(
          current.status === "open"
            ? "There are no more hints."
            : "That problem was already submitted or replaced.",
        );
      }
      yield* changed(input.threadId);
      return { problem: problemView(row) };
    });

    const submitSolution: LearningService["Service"]["submitSolution"] = Effect.fn(
      "LearningService.submitSolution",
    )(function* (input) {
      const current = yield* readProblem(input.threadId, input.problemId);
      if (current.status !== "open")
        return yield* fail("That problem was already submitted or replaced.");
      const { workspace } = storedProblem(current);
      const problem = solutionProblem(input, workspace !== null);
      if (problem !== undefined) return yield* fail(problem);
      const checkCommand = workspace?.checkCommand ?? null;
      const check =
        workspace === null || checkCommand === null || input.gaveUp
          ? undefined
          : yield* runWorkspaceCheck(input.threadId, input.problemId, {
              ...workspace,
              checkCommand,
            });
      const attempt: LearningProblemAttempt = {
        ...(input.text?.trim() ? { text: input.text.trim() } : {}),
        ...(check === undefined
          ? {}
          : { check: { exitCode: check.exitCode, timedOut: check.timedOut } }),
        gaveUp: input.gaveUp,
        ...(input.confidence === undefined || input.gaveUp ? {} : { confidence: input.confidence }),
        ...(input.thinking?.trim() ? { thinking: input.thinking.trim() } : {}),
        submittedAt: yield* nowIso,
      };
      const claimed = yield* sql<ProblemRow>`
        UPDATE learning_problems SET status = 'submitted', attempt_json = ${encodeAttempt(attempt)}
        WHERE problem_id = ${input.problemId} AND thread_id = ${input.threadId} AND status = 'open'
        RETURNING *
      `.pipe(Effect.mapError(dbError("Could not save your work.")));
      const row = claimed[0];
      // Two submits can race; only the one that flipped the row sends the message.
      if (row === undefined) return yield* fail("That problem was already submitted or replaced.");
      const reopen = sql`
        UPDATE learning_problems SET status = 'open', attempt_json = NULL
        WHERE problem_id = ${row.problem_id} AND status = 'submitted'
      `.pipe(Effect.ignore);
      yield* sendToTutor(
        input.threadId,
        "learning-solution",
        formatSolutionMessage(storedProblem(row), attempt, row.hints_used, check),
      ).pipe(Effect.onError(() => reopen));
      yield* changed(input.threadId);
      return { problem: problemView(row) };
    });

    const runCheck: LearningService["Service"]["runCheck"] = Effect.fn("LearningService.runCheck")(
      function* (input) {
        const { workspace } = storedProblem(yield* readProblem(input.threadId, input.problemId));
        const checkCommand = workspace?.checkCommand ?? null;
        if (workspace === null || checkCommand === null)
          return yield* fail("This problem has no check to run.");
        return yield* runWorkspaceCheck(input.threadId, input.problemId, {
          ...workspace,
          checkCommand,
        });
      },
    );

    const practiceFolder: LearningService["Service"]["practiceFolder"] = Effect.fn(
      "LearningService.practiceFolder",
    )(function* (input) {
      const { workspace } = storedProblem(yield* readProblem(input.threadId, input.problemId));
      if (workspace === null) return yield* fail("This problem has no practice folder.");
      const folder = yield* existingWorkspaceFolder(input.threadId, workspace);
      if (folder === null) return yield* fail(`The practice folder ${workspace.folder} is gone.`);
      return folder;
    });

    const concludeProblem: LearningService["Service"]["concludeProblem"] = Effect.fn(
      "LearningService.concludeProblem",
    )(function* (threadId, input) {
      const problem = conclusionProblem(input);
      if (problem !== undefined) return yield* fail(problem);
      const conclusion: LearningProblemConclusion = {
        outcome: input.outcome,
        verdict: input.verdict.trim(),
        ...(input.missType === undefined ? {} : { missType: input.missType }),
        retest: input.retest,
        concludedAt: yield* nowIso,
      };
      const concluded = yield* sql<{ problem_id: string }>`
        UPDATE learning_problems SET status = 'concluded', conclusion_json = ${encodeConclusion(conclusion)}
        WHERE problem_id = ${input.problemId} AND thread_id = ${threadId} AND status = 'submitted'
        RETURNING problem_id
      `.pipe(Effect.mapError(dbError("Could not save the verdict.")));
      if (concluded.length === 0) {
        const current = yield* readProblem(threadId, input.problemId);
        return yield* fail(
          current.status === "open"
            ? "The learner has not submitted their work yet. Wait for it before concluding."
            : current.status === "concluded"
              ? "That problem is already concluded."
              : "That problem was replaced before the learner submitted it.",
        );
      }
      yield* changed(threadId);
    });

    const getTutorPrompt: LearningService["Service"]["getTutorPrompt"] = () =>
      readTutorPrompt(promptLocation).pipe(
        Effect.map((current) => ({ ...current, defaultPrompt: DEFAULT_TUTOR_PROMPT })),
      );

    const setTutorPrompt: LearningService["Service"]["setTutorPrompt"] = (input) =>
      writeTutorPrompt(promptLocation, input.prompt).pipe(
        Effect.mapError(dbError("Could not save the tutor prompt.")),
        Effect.andThen(getTutorPrompt()),
      );

    const getKnowledge: LearningService["Service"]["getKnowledge"] = Effect.fn(
      "LearningService.getKnowledge",
    )(
      function* () {
        const propositions = yield* listPropositions({ words: [], limit: Number.MAX_SAFE_INTEGER });
        const chains = yield* chainsAmong(null);
        const sessions = yield* sql<SessionRow>`
          SELECT thread_id, project_id, title, created_at FROM orchestration_v2_projection_threads
          WHERE deleted_at IS NULL AND thread_id IN (
            SELECT thread_id FROM learning_proposition_sources
            UNION SELECT thread_id FROM learning_chains
          )
        `;
        return {
          propositions,
          chains,
          sessions: sessions.map((row) => ({
            threadId: row.thread_id as ThreadId,
            projectId: row.project_id as ProjectId,
            title: row.title,
            createdAt: row.created_at,
          })),
        };
      },
      Effect.mapError(dbError("Could not read the knowledge graph.")),
    );

    return LearningService.of({
      askQuestion,
      poseProblem,
      concludeProblem,
      finishMeasuring,
      setPlan,
      searchGraph,
      recordGraph,
      getThreadState,
      subscribeThread,
      answer,
      revealHint,
      submitSolution,
      runCheck,
      practiceFolder,
      getTutorPrompt,
      setTutorPrompt,
      getKnowledge,
    });
  }),
);
