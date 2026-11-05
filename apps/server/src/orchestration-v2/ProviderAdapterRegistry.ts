import { ProviderInstanceId, type OrchestrationV2ProviderCapabilities } from "@aprende/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { ProviderAdapterDriverCreateError } from "@aprende/provider-core/server/adapterDriver";
import * as ProviderAdapter from "@aprende/provider-core/server/ProviderAdapter";

export class ProviderAdapterRegistryLookupError extends Schema.TaggedError<ProviderAdapterRegistryLookupError>()(
  "ProviderAdapterRegistryLookupError",
  {
    instanceId: ProviderInstanceId,
  },
) {
  override get message(): string {
    return `No orchestration provider adapter is registered for ${this.instanceId}.`;
  }
}

export class ProviderAdapterRegistryMetadataError extends Schema.TaggedError<ProviderAdapterRegistryMetadataError>()(
  "ProviderAdapterRegistryMetadataError",
  { instanceId: ProviderInstanceId, cause: Schema.Defect() },
) {}

export const ProviderAdapterRegistryV2Error = Schema.Union([
  ProviderAdapterRegistryLookupError,
  ProviderAdapterRegistryMetadataError,
  ProviderAdapterDriverCreateError,
]);
export type ProviderAdapterRegistryV2Error = typeof ProviderAdapterRegistryV2Error.Type;

export interface ProviderAdapterRegistryV2Shape {
  readonly get: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapter.ProviderAdapterV2["Service"], ProviderAdapterRegistryV2Error>;
  readonly list: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
  readonly getMetadata?: (instanceId: ProviderInstanceId) => Effect.Effect<
    {
      readonly driver: ProviderAdapter.ProviderAdapterV2["Service"]["driver"];
      readonly continuationKey: string;
      readonly enabled: boolean;
      readonly capabilities: OrchestrationV2ProviderCapabilities;
    },
    ProviderAdapterRegistryV2Error
  >;
}

export class ProviderAdapterRegistryV2 extends Context.Service<
  ProviderAdapterRegistryV2,
  ProviderAdapterRegistryV2Shape
>()("aprende/orchestration-v2/ProviderAdapterRegistry/ProviderAdapterRegistryV2") {}

export const layerFromProviderInstanceRegistry: Layer.Layer<
  ProviderAdapterRegistryV2,
  never,
  ProviderInstanceRegistry.ProviderInstanceRegistry
> = Layer.effect(
  ProviderAdapterRegistryV2,
  Effect.gen(function* () {
    const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    return ProviderAdapterRegistryV2.of({
      get: Effect.fn("ProviderAdapterRegistryV2.get")(function (instanceId) {
        return instances
          .getInstance(instanceId)
          .pipe(
            Effect.flatMap((instance) =>
              instance === undefined
                ? new ProviderAdapterRegistryLookupError({ instanceId })
                : Effect.succeed(instance.orchestrationAdapter),
            ),
          );
      }),
      list: Effect.fn("ProviderAdapterRegistryV2.list")(function () {
        return instances.listInstances.pipe(
          Effect.map((available) => available.map((instance) => instance.instanceId)),
        );
      }),
      getMetadata: Effect.fn("ProviderAdapterRegistry.getMetadata")(function* (instanceId) {
        const instance = yield* instances.getInstance(instanceId);
        if (instance === undefined) {
          return yield* new ProviderAdapterRegistryLookupError({ instanceId });
        }
        const capabilities = yield* instance.orchestrationAdapter
          .getCapabilities()
          .pipe(
            Effect.mapError(
              (cause) => new ProviderAdapterRegistryMetadataError({ instanceId, cause }),
            ),
          );
        return {
          driver: instance.driverKind,
          continuationKey: instance.continuationIdentity.continuationKey,
          enabled: instance.enabled,
          capabilities,
        };
      }),
    });
  }),
);

function makeRegistry(
  adapters: ReadonlyArray<ProviderAdapter.ProviderAdapterV2["Service"]>,
): ProviderAdapterRegistryV2Shape {
  return {
    get: Effect.fn("ProviderAdapterRegistry.get")(function* (instanceId) {
      const adapter = adapters.find((candidate) => candidate.instanceId === instanceId);
      if (!adapter) {
        return yield* new ProviderAdapterRegistryLookupError({ instanceId });
      }
      return adapter;
    }),
    list: () => Effect.succeed(adapters.map((adapter) => adapter.instanceId)),
  };
}

export function layerFromAdapters(
  adapters: ReadonlyArray<ProviderAdapter.ProviderAdapterV2["Service"]>,
): Layer.Layer<ProviderAdapterRegistryV2> {
  return Layer.succeed(
    ProviderAdapterRegistryV2,
    ProviderAdapterRegistryV2.of(makeRegistry(adapters)),
  );
}

export function layerFromAdaptersEffect<R, E>(
  adapters: Effect.Effect<ReadonlyArray<ProviderAdapter.ProviderAdapterV2["Service"]>, E, R>,
): Layer.Layer<ProviderAdapterRegistryV2, E, Exclude<R, Scope.Scope>> {
  return Layer.effect(
    ProviderAdapterRegistryV2,
    adapters.pipe(Effect.map((entries) => ProviderAdapterRegistryV2.of(makeRegistry(entries)))),
  );
}

export function layerSingle(
  adapter: ProviderAdapter.ProviderAdapterV2["Service"],
): Layer.Layer<ProviderAdapterRegistryV2> {
  return layerFromAdapters([adapter]);
}
