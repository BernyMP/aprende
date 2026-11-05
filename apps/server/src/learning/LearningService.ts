import {
  CommandId,
  LearningAnswer,
  LearningAssessment,
  LearningError,
  LearningPlan,
  MessageId,
  type LearningAnswerInput,
  type LearningAnswerResult,
  type LearningChain,
  type LearningKnowledge,
  type LearningPlanEdge,
  type LearningPlanNode,
  type LearningProposition,
  type LearningQuestionView,
  type LearningSetTutorPromptInput,
  type LearningStrand,
  type LearningThreadState,
  type LearningTutorPrompt,
  type ThreadId,
} from "@aprende/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { ServerConfig } from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import {
  answerProblem,
  formatAnswerMessage,
  gradeAnswer,
  planProblem,
  questionDraftProblem,
  shuffleOptions,
  type QuestionDraft,
  type StoredQuestion,
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

export class LearningService extends Context.Service<
  LearningService,
  {
    readonly askQuestion: (
      threadId: ThreadId,
      draft: QuestionDraft,
    ) => Effect.Effect<{ readonly questionId: string }, LearningError>;
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
    readonly getTutorPrompt: () => Effect.Effect<LearningTutorPrompt, LearningError>;
    readonly setTutorPrompt: (
      input: LearningSetTutorPromptInput,
    ) => Effect.Effect<LearningTutorPrompt, LearningError>;
    readonly getKnowledge: () => Effect.Effect<LearningKnowledge, LearningError>;
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

interface PropositionRow {
  readonly proposition_id: string;
  readonly name: string;
  readonly statement: string;
  readonly created_at: string;
  readonly source_thread_ids: string | null;
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
          sql`UPDATE learning_questions SET status = 'skipped' WHERE thread_id = ${threadId} AND status = 'open'`.pipe(
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
        const propositions = yield* listPropositions({ words, limit: input.limit ?? 50 });
        const chains = yield* chainsAmong(new Set(propositions.map((entry) => entry.id)));
        return { propositions, chains };
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
        const shell = yield* threads.getThreadShell(input.threadId).pipe(
          Effect.mapError(dbError("Could not find the session.")),
          Effect.onError(() => reopen),
        );
        if (shell === null) {
          yield* reopen;
          return yield* fail("Could not find the session.");
        }
        const sendId = yield* newId("learning-answer");
        yield* threads
          .sendToThread({
            projectId: shell.projectId,
            commandId: CommandId.make(sendId),
            threadId: input.threadId,
            messageId: MessageId.make(sendId),
            text: formatAnswerMessage(question, recorded),
            attachments: [],
            mode: "queue",
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(
            Effect.mapError(dbError("Could not send the answer to the tutor.")),
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
        return { propositions, chains };
      },
      Effect.mapError(dbError("Could not read the knowledge graph.")),
    );

    return LearningService.of({
      askQuestion,
      finishMeasuring,
      setPlan,
      searchGraph,
      recordGraph,
      getThreadState,
      subscribeThread,
      answer,
      getTutorPrompt,
      setTutorPrompt,
      getKnowledge,
    });
  }),
);
