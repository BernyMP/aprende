import { assert, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadShell,
  type ServerSettings as ContractServerSettings,
  type ServerSettingsPatch,
} from "@aprende/contracts";
import { applyServerSettingsPatch } from "@aprende/shared/serverSettings";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerActivation from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadSettlementService from "./ThreadSettlementService.ts";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

function at(offsetMs: number): DateTime.Utc {
  return DateTime.makeUnsafe(NOW_MS + offsetMs);
}

type SettlementShell = OrchestrationV2ThreadShell &
  Pick<ProjectionStore.ProjectionSettlementCandidate, "latestUserAuthoredMessageAt">;

function shell(overrides: Partial<SettlementShell> = {}): SettlementShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    latestUserAuthoredMessageAt: overrides.latestUserMessageAt ?? null,
    createdAt: at(-30 * DAY_MS),
    updatedAt: at(-10 * DAY_MS),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

describe("isAutoSettlementCandidate", () => {
  it("settles a thread whose only background work is a command left running", () => {
    expect(
      ThreadSettlementService.isAutoSettlementCandidate(
        shell({
          pendingBackgroundTasks: [
            { taskId: "dev", kind: "command", description: "vp run dev --share" },
          ],
        }),
        NOW_MS,
      ),
    ).toBe(true);
  });

  it("keeps snoozed threads parked until a fresh failure or timer wake", () => {
    const snoozed = shell({
      snoozedUntil: at(60 * 60 * 1_000),
      snoozedAt: at(-60 * 60 * 1_000),
    });
    expect(ThreadSettlementService.isAutoSettlementCandidate(snoozed, NOW_MS)).toBe(false);
    expect(
      ThreadSettlementService.isAutoSettlementCandidate(
        shell({ ...snoozed, status: "failed", latestRunCompletedAt: at(-30 * 60 * 1_000) }),
        NOW_MS,
      ),
    ).toBe(true);
    expect(
      ThreadSettlementService.isAutoSettlementCandidate(
        shell({ ...snoozed, status: "failed", latestRunCompletedAt: at(-2 * 60 * 60 * 1_000) }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      ThreadSettlementService.isAutoSettlementCandidate(
        shell({ ...snoozed, status: "failed", latestRunCompletedAt: snoozed.snoozedAt }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      ThreadSettlementService.isAutoSettlementCandidate(
        shell({ ...snoozed, status: "failed", latestRunCompletedAt: null }),
        NOW_MS,
      ),
    ).toBe(false);
    expect(
      ThreadSettlementService.isAutoSettlementCandidate(
        shell({ ...snoozed, snoozedUntil: at(-1) }),
        NOW_MS,
      ),
    ).toBe(true);
  });
});

describe("resolveAutoSettlementAt", () => {
  it("uses the latest activity time when the inactivity window elapses", () => {
    const idle = shell({
      latestUserMessageAt: at(-4 * DAY_MS),
      latestRunRequestedAt: at(-4 * DAY_MS),
      latestRunStartedAt: at(-4 * DAY_MS),
      latestRunCompletedAt: at(-3 * DAY_MS),
    });
    const input = {
      thread: idle,
      nowMs: NOW_MS,
      autoSettleAfterDays: 2,
    };
    expect(ThreadSettlementService.resolveAutoSettlementAt(input)).toEqual(at(-3 * DAY_MS));
    expect(
      ThreadSettlementService.resolveAutoSettlementAt({ ...input, autoSettleAfterDays: 5 }),
    ).toBeNull();
    expect(
      ThreadSettlementService.resolveAutoSettlementAt({ ...input, autoSettleAfterDays: null }),
    ).toBeNull();
  });

  it("anchors an empty thread's inactivity at its creation time", () => {
    const input = {
      thread: shell({ createdAt: at(-3 * DAY_MS) }),
      nowMs: NOW_MS,
      autoSettleAfterDays: 2,
    };
    expect(ThreadSettlementService.resolveAutoSettlementAt(input)).toEqual(at(-3 * DAY_MS));
    expect(
      ThreadSettlementService.resolveAutoSettlementAt({
        ...input,
        thread: shell({ createdAt: at(-DAY_MS) }),
      }),
    ).toBeNull();
    expect(
      ThreadSettlementService.resolveAutoSettlementAt({
        ...input,
        thread: { ...input.thread, lastSnoozeWakeAt: at(-DAY_MS) },
      }),
    ).toBeNull();
  });

  it.each(["manual", "timer"])("restarts inactivity on a %s snooze wake", (wake) => {
    const thread = {
      ...shell({ latestRunCompletedAt: at(-4 * DAY_MS) }),
      ...(wake === "manual"
        ? { lastSnoozeWakeAt: at(-1_000) }
        : { snoozedAt: at(-3 * DAY_MS), snoozedUntil: at(-1_000) }),
    };
    const input = {
      thread,
      nowMs: NOW_MS,
      autoSettleAfterDays: 1,
    };
    expect(ThreadSettlementService.resolveAutoSettlementAt(input)).toBeNull();
    expect(
      ThreadSettlementService.resolveAutoSettlementAt({ ...input, nowMs: NOW_MS + DAY_MS }),
    ).toEqual(at(-1_000));
  });
});

const NOW = "2026-08-28T12:00:00.000Z";
const SCRATCH_ROOT = "/workspace/scratch";
const PROJECT_ID = ProjectId.make("settlement-project");

describe("autoSettlementSettingsKey", () => {
  it("distinguishes a project that inherits the threshold from one that disables it", () => {
    const inherits = ThreadSettlementService.autoSettlementSettingsKey({
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: { [PROJECT_ID]: {} },
    });
    const never = ThreadSettlementService.autoSettlementSettingsKey({
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [PROJECT_ID]: { sidebarAutoSettleAfterDays: null },
      },
    });
    assert.notStrictEqual(inherits, never);
  });
});

type AutoSettleCommand = Extract<OrchestrationV2Command, { readonly type: "thread.auto-settle" }>;

const testCrypto = SecureRandom.make((size) => new Uint8Array(size).fill(1));

function makeProject(
  id: ProjectId = PROJECT_ID,
  workspaceRoot = "/workspace/project",
): OrchestrationProjectShell {
  return {
    id,
    title: `Project ${id}`,
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: NOW,
  };
}

function makeThread(id: string, overrides: Partial<SettlementShell> = {}): SettlementShell {
  return shell({
    id: ThreadId.make(id),
    projectId: PROJECT_ID,
    title: id,
    createdAt: DateTime.makeUnsafe("2026-08-01T00:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-08-20T00:00:00.000Z"),
    latestUserMessageAt: DateTime.makeUnsafe("2026-08-20T00:00:00.000Z"),
    ...overrides,
  });
}

type SettlementSnapshot = Omit<OrchestrationV2ShellSnapshot, "threads"> & {
  readonly threads: ReadonlyArray<SettlementShell>;
};

function makeSnapshot(
  threads: ReadonlyArray<SettlementShell>,
  projects: ReadonlyArray<OrchestrationProjectShell> = [makeProject()],
): SettlementSnapshot {
  return {
    schemaVersion: 1,
    snapshotSequence: 1,
    projects,
    threads,
    archivedThreads: [],
  };
}

interface HarnessOptions {
  readonly snapshot: SettlementSnapshot;
  readonly settings?: ContractServerSettings;
  readonly onDispatch?: (command: AutoSettleCommand) => Effect.Effect<void>;
  readonly currentThreads?: ReadonlyArray<OrchestrationV2AppThread>;
  readonly quickQuestionProjectId?: ProjectId;
}

const makeHarness = Effect.fn("makeThreadSettlementHarness")(function* (options: HarnessOptions) {
  const activation = yield* Deferred.make<void>();
  const snapshots = yield* Ref.make(options.snapshot);
  const snapshotReadCount = yield* Ref.make(0);
  const snapshotReads = yield* Queue.unbounded<number>();
  const candidateReads = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
  const settings = yield* Ref.make(options.settings ?? DEFAULT_SERVER_SETTINGS);
  const settingsReadCount = yield* Ref.make(0);
  const settingsChanges = yield* PubSub.unbounded<ContractServerSettings>();
  const commands = yield* Ref.make<ReadonlyArray<AutoSettleCommand>>([]);
  const domainEvents = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();

  const updateSettings = (patch: ServerSettingsPatch) =>
    Effect.gen(function* () {
      const next = applyServerSettingsPatch(yield* Ref.get(settings), patch);
      yield* Ref.set(settings, next);
      yield* PubSub.publish(settingsChanges, next);
      return next;
    });

  const dispatch: Orchestrator.OrchestratorV2Shape["dispatch"] = (command) => {
    if (command.type !== "thread.auto-settle") {
      return Effect.die(new Error(`Unexpected command: ${command.type}`));
    }
    return Ref.update(commands, (recorded) => [...recorded, command]).pipe(
      Effect.andThen(options.onDispatch?.(command) ?? Effect.void),
      Effect.as({ sequence: 1, storedEvents: [] }),
    );
  };

  const serverSettings = ServerSettings.ServerSettingsService.of({
    start: Effect.void,
    ready: Effect.void,
    getSettings: Ref.update(settingsReadCount, (count) => count + 1).pipe(
      Effect.andThen(Ref.get(settings)),
    ),
    updateSettings,
    updateProviderInstance: () => Effect.die("Unexpected provider mutation"),
    withSettingsSnapshot: (use) => Ref.get(settings).pipe(Effect.flatMap(use)),
    streamChanges: Stream.fromPubSub(settingsChanges),
    subscribeChanges: PubSub.subscribe(settingsChanges).pipe(
      Effect.map((subscription) => Stream.fromSubscription(subscription)),
    ),
  });

  const layerDependencies = Layer.mergeAll(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      listShells: () => Ref.get(snapshots).pipe(Effect.map((snapshot) => snapshot.projects)),
      findActiveByWorkspaceRoot: (workspaceRoot) =>
        Effect.succeed(
          workspaceRoot === SCRATCH_ROOT && options.quickQuestionProjectId !== undefined
            ? Option.some({ projectId: options.quickQuestionProjectId } as ProjectStore.ProjectRow)
            : Option.none(),
        ),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getSettlementCandidates: (threadId) =>
        Ref.update(candidateReads, (reads) => [...reads, threadId]).pipe(
          Effect.andThen(Ref.updateAndGet(snapshotReadCount, (count) => count + 1)),
          Effect.tap((count) => Queue.offer(snapshotReads, count)),
          Effect.andThen(Ref.get(snapshots)),
          Effect.map((snapshot) =>
            threadId === undefined
              ? snapshot.threads
              : snapshot.threads.filter((thread) => thread.id === threadId),
          ),
        ),
      getThread: (threadId) => {
        const thread = options.currentThreads?.find((candidate) => candidate.id === threadId);
        return thread
          ? Effect.succeed(thread)
          : Effect.die(new Error(`Unexpected thread read: ${threadId}`));
      },
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromPubSub(domainEvents),
      dispatch,
    }),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/workspace",
      scratchRoot: Effect.succeedSome(SCRATCH_ROOT),
    }),
    Layer.succeed(ServerSettings.ServerSettingsService, serverSettings),
    Layer.succeed(ServerActivation.ServerActivation, Deferred.await(activation)),
    Layer.succeed(SecureRandom.SecureRandom, testCrypto),
    Path.layer,
  );

  return {
    activation,
    snapshots,
    snapshotReadCount,
    settingsReadCount,
    snapshotReads,
    candidateReads,
    commands,
    publishEvent: (event: OrchestrationV2DomainEvent) => PubSub.publish(domainEvents, event),
    updateSettings,
    layer: Layer.effect(
      ThreadSettlementService.ThreadSettlementServiceV2,
      ThreadSettlementService.make,
    ).pipe(Layer.provide(layerDependencies)),
  };
});

const startHarness = Effect.fn("startThreadSettlementHarness")(function* (
  reactor: ThreadSettlementService.ThreadSettlementServiceV2["Service"],
  activation: Deferred.Deferred<void>,
  snapshotReads: Queue.Queue<number>,
) {
  yield* reactor.start();
  yield* Deferred.succeed(activation, undefined);
  yield* Queue.take(snapshotReads);
  yield* reactor.drain;
});

describe("ThreadSettlementServiceV2 worker", () => {
  it.effect("skips settings decisions for recent threads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const threads = Array.from({ length: 32 }, (_, index) =>
          makeThread(`recent-${index}`, {
            updatedAt: DateTime.makeUnsafe(NOW),
            latestUserMessageAt: DateTime.makeUnsafe(Date.parse(NOW) - 2 * DAY_MS),
          }),
        );
        const fixture = yield* makeHarness({
          snapshot: makeSnapshot(threads),
          settings: { ...DEFAULT_SERVER_SETTINGS, sidebarAutoSettleAfterDays: 3 },
        });
        yield* Effect.gen(function* () {
          const service = yield* ThreadSettlementService.ThreadSettlementServiceV2;
          yield* startHarness(service, fixture.activation, fixture.snapshotReads);
          assert.deepEqual(yield* Ref.get(fixture.commands), []);
          assert.equal(yield* Ref.get(fixture.settingsReadCount), 2);
          yield* fixture.updateSettings({ sidebarAutoSettleAfterDays: 1 });
          yield* Queue.take(fixture.snapshotReads);
          yield* service.drain;
          assert.deepEqual(
            new Set((yield* Ref.get(fixture.commands)).map((command) => command.threadId)),
            new Set(threads.map((thread) => thread.id)),
          );
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect("settles only the project opted in while environment settlement is disabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const thread = makeThread("project-opt-in", {
          latestRunCompletedAt: DateTime.makeUnsafe("2026-08-25T00:00:00.000Z"),
        });
        const other = makeThread("environment-off", { projectId: ProjectId.make("other-project") });
        const fixture = yield* makeHarness({
          snapshot: makeSnapshot([thread, other]),
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            sidebarAutoSettleAfterDays: null,
            projectSettingsOverrides: { [PROJECT_ID]: { sidebarAutoSettleAfterDays: 2 } },
          },
        });
        yield* Effect.gen(function* () {
          const service = yield* ThreadSettlementService.ThreadSettlementServiceV2;
          yield* startHarness(service, fixture.activation, fixture.snapshotReads);
          const commands = yield* Ref.get(fixture.commands);
          expect(commands.map((command) => command.threadId)).toEqual([thread.id]);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );

  it.effect(
    "settles a quick question after one idle day while lessons wait the configured days",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.parse(NOW));
          const quickQuestions = ProjectId.make("quick-questions");
          const idleSince = DateTime.makeUnsafe(Date.parse(NOW) - 2 * DAY_MS);
          const idle = { updatedAt: idleSince, latestUserMessageAt: idleSince };
          const question = makeThread("quick-question", { ...idle, projectId: quickQuestions });
          const usedToday = makeThread("quick-question-in-use", {
            projectId: quickQuestions,
            updatedAt: DateTime.makeUnsafe(NOW),
            latestUserMessageAt: DateTime.makeUnsafe(Date.parse(NOW) - DAY_MS / 2),
          });
          const lesson = makeThread("lesson", idle);
          const fixture = yield* makeHarness({
            snapshot: makeSnapshot([question, usedToday, lesson]),
            settings: { ...DEFAULT_SERVER_SETTINGS, sidebarAutoSettleAfterDays: 3 },
            quickQuestionProjectId: quickQuestions,
          });
          yield* Effect.gen(function* () {
            const service = yield* ThreadSettlementService.ThreadSettlementServiceV2;
            yield* startHarness(service, fixture.activation, fixture.snapshotReads);
            const commands = yield* Ref.get(fixture.commands);
            expect(commands.map((command) => command.threadId)).toEqual([question.id]);
          }).pipe(Effect.provide(fixture.layer));
        }),
      ),
  );

  it.effect("stops settling the rest of a sweep once auto-settlement is turned off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        // Sweeps settle 8 threads at a time, so the ninth starts after a dispatch turned it off.
        const threads = Array.from({ length: 9 }, (_, index) => makeThread(`idle-${index}`));
        let disable: Effect.Effect<unknown> = Effect.void;
        const fixture = yield* makeHarness({
          snapshot: makeSnapshot(threads),
          settings: { ...DEFAULT_SERVER_SETTINGS, sidebarAutoSettleAfterDays: 3 },
          onDispatch: () => disable,
        });
        disable = fixture.updateSettings({ sidebarAutoSettleAfterDays: null });
        yield* Effect.gen(function* () {
          const service = yield* ThreadSettlementService.ThreadSettlementServiceV2;
          yield* startHarness(service, fixture.activation, fixture.snapshotReads);
          const settled = (yield* Ref.get(fixture.commands)).map((command) => command.threadId);
          expect(settled).not.toContain(threads[8]!.id);
        }).pipe(Effect.provide(fixture.layer));
      }),
    ),
  );
});

describe("isSnoozed", () => {
  const snoozed = { snoozedAt: at(-2 * DAY_MS), snoozedUntil: at(DAY_MS) };
  it("keeps a run requested and completed after snoozing parked until the timer", () => {
    const thread = shell({
      ...snoozed,
      status: "completed",
      latestRunRequestedAt: at(-2 * DAY_MS + 1),
      latestRunStartedAt: at(-DAY_MS - 1),
      latestRunCompletedAt: at(-DAY_MS),
    });

    expect(ThreadSettlementService.isSnoozed(thread, NOW_MS)).toBe(true);
    expect(ThreadSettlementService.isAutoSettlementCandidate(thread, NOW_MS)).toBe(false);
    expect(
      ThreadSettlementService.resolveAutoSettlementAt({
        thread,
        nowMs: NOW_MS,
        autoSettleAfterDays: 1,
      }),
    ).toBeNull();
  });
});
