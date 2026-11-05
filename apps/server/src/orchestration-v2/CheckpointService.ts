import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@aprende/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as IdAllocator from "@aprende/provider-core/server/IdAllocator";

const ROOT_CHECKPOINT_SCOPE_NAME = "root";

export class CheckpointRootScopePrepareError extends Schema.TaggedError<CheckpointRootScopePrepareError>()(
  "CheckpointRootScopePrepareError",
  {
    threadId: ThreadId,
    runId: RunId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to prepare root checkpoint scope for run ${this.runId}.`;
  }
}

export class CheckpointCaptureError extends Schema.TaggedError<CheckpointCaptureError>()(
  "CheckpointCaptureError",
  {
    scopeId: CheckpointScopeId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to record checkpoint for scope ${this.scopeId}.`;
  }
}

export const CheckpointServiceV2Error = Schema.Union([
  CheckpointRootScopePrepareError,
  CheckpointCaptureError,
]);
export type CheckpointServiceV2Error = typeof CheckpointServiceV2Error.Type;

/**
 * A checkpoint marks a turn boundary in the conversation: rewind and fork target it. It records
 * no files; rewinding the conversation leaves the learner's files alone.
 */
export interface CheckpointServiceV2Shape {
  readonly prepareRootRunScope: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly rootNodeId: NodeId;
    readonly providerThreadId: ProviderThreadId;
    readonly cwd: string;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2CheckpointScope, CheckpointServiceV2Error>;
  readonly materializeBaselineCheckpoint: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
  readonly capture: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly runId: RunId | null;
    readonly nodeId: NodeId;
    readonly ordinalWithinScope: number;
    readonly appRunOrdinal: number | null;
    readonly capturedAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
}

export class CheckpointServiceV2 extends Context.Service<
  CheckpointServiceV2,
  CheckpointServiceV2Shape
>()("aprende/orchestration-v2/CheckpointService/CheckpointServiceV2") {}

function checkpointRefFor(input: {
  readonly scopeId: CheckpointScopeId;
  readonly ordinalWithinScope: number;
}): CheckpointRef {
  return CheckpointRef.make(`${input.scopeId}/ordinal/${input.ordinalWithinScope}`);
}

function checkpointIdForScopeOrdinal(
  idAllocator: IdAllocator.IdAllocatorV2["Service"],
  input: {
    readonly scopeId: CheckpointScopeId;
    readonly ordinalWithinScope: number;
  },
) {
  return idAllocator.allocate.checkpoint({
    checkpointScopeId: input.scopeId,
    name: String(input.ordinalWithinScope),
  });
}

function makeCheckpoint(input: {
  readonly id: CheckpointId;
  readonly scope: OrchestrationV2CheckpointScope;
  readonly runId: RunId | null;
  readonly nodeId: NodeId;
  readonly parentCheckpointId: CheckpointId | null;
  readonly ordinalWithinScope: number;
  readonly appRunOrdinal: number | null;
  readonly capturedAt: DateTime.Utc;
}): OrchestrationV2Checkpoint {
  return {
    id: input.id,
    threadId: input.scope.threadId,
    scopeId: input.scope.id,
    runId: input.runId,
    nodeId: input.nodeId,
    parentCheckpointId: input.parentCheckpointId,
    ordinalWithinScope: input.ordinalWithinScope,
    appRunOrdinal: input.appRunOrdinal,
    ref: checkpointRefFor({
      scopeId: input.scope.id,
      ordinalWithinScope: input.ordinalWithinScope,
    }),
    status: "ready",
    files: [],
    capturedAt: input.capturedAt,
  };
}

export const layer: Layer.Layer<CheckpointServiceV2, never, IdAllocator.IdAllocatorV2> =
  Layer.effect(
    CheckpointServiceV2,
    Effect.gen(function* () {
      const idAllocator = yield* IdAllocator.IdAllocatorV2;

      const prepareRootRunScope: CheckpointServiceV2Shape["prepareRootRunScope"] = (input) =>
        idAllocator.allocate
          .checkpointScope({ threadId: input.threadId, name: ROOT_CHECKPOINT_SCOPE_NAME })
          .pipe(
            Effect.map((scopeId): OrchestrationV2CheckpointScope => ({
              id: scopeId,
              threadId: input.threadId,
              runId: input.runId,
              nodeId: input.rootNodeId,
              parentScopeId: null,
              providerThreadId: input.providerThreadId,
              kind: "root_run",
              ordinalWithinParent: 0,
              advancesAppRunCount: true,
              cwd: input.cwd,
              createdAt: input.createdAt,
            })),
            Effect.mapError(
              (cause) =>
                new CheckpointRootScopePrepareError({
                  threadId: input.threadId,
                  runId: input.runId,
                  cause,
                }),
            ),
          );

      const materializeBaselineCheckpoint: CheckpointServiceV2Shape["materializeBaselineCheckpoint"] =
        (input) =>
          checkpointIdForScopeOrdinal(idAllocator, {
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          }).pipe(
            Effect.map((id) =>
              makeCheckpoint({
                id,
                scope: input.scope,
                runId: null,
                nodeId: input.scope.nodeId,
                parentCheckpointId: null,
                ordinalWithinScope: input.ordinalWithinScope,
                appRunOrdinal: null,
                capturedAt: input.scope.createdAt,
              }),
            ),
            Effect.mapError(
              (cause) => new CheckpointCaptureError({ scopeId: input.scope.id, cause }),
            ),
          );

      const capture: CheckpointServiceV2Shape["capture"] = Effect.fn("CheckpointService.capture")(
        function* (input) {
          const id = yield* checkpointIdForScopeOrdinal(idAllocator, {
            scopeId: input.scope.id,
            ordinalWithinScope: input.ordinalWithinScope,
          });
          const parentCheckpointId =
            input.ordinalWithinScope > 0
              ? yield* checkpointIdForScopeOrdinal(idAllocator, {
                  scopeId: input.scope.id,
                  ordinalWithinScope: input.ordinalWithinScope - 1,
                })
              : null;
          return makeCheckpoint({ ...input, id, parentCheckpointId });
        },
        (effect, input) =>
          effect.pipe(
            Effect.mapError(
              (cause) => new CheckpointCaptureError({ scopeId: input.scope.id, cause }),
            ),
          ),
      );

      return CheckpointServiceV2.of({
        prepareRootRunScope,
        materializeBaselineCheckpoint,
        capture,
      });
    }),
  );
