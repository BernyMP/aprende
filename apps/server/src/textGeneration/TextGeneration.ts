import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId } from "@aprende/contracts";
import {
  isProviderAvailable,
  isProviderTextGenerationCapable,
  resolveProjectProviderInstanceEnabled,
} from "@aprende/contracts";
import * as DateTime from "effect/DateTime";
import { exhaustedUsageWindow } from "@aprende/shared/usageLimits";
import { fallbackTextGenerationModelSelection } from "@aprende/shared/serverSettings";
import * as ServerSettings from "../serverSettings.ts";
import type { ProviderTextGeneration } from "@aprende/provider-core/server/textGeneration";
import { TextGenerationError } from "@aprende/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@aprende/provider-core/server/driver";

export type {
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@aprende/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "aprende/textGeneration/TextGeneration",
) {}

type TextGenerationOp = "generateThreadTitle";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

/** @public */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const generate = Effect.fn("TextGeneration.generate")(function* <A>(
    operation: TextGenerationOp,
    selection: ModelSelection,
    invoke: (
      service: ProviderTextGeneration,
      modelSelection: ModelSelection,
    ) => Effect.Effect<A, TextGenerationError>,
  ) {
    const snapshots = yield* registry.listInstances.pipe(
      Effect.flatMap((instances) =>
        Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot),
      ),
    );
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const limited = exhaustedUsageWindow(
      snapshots.find((provider) => provider.instanceId === selection.instanceId),
      now,
    );
    if (limited) {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Could not read fallback model settings.",
              cause,
            }),
        ),
      );
      selection =
        fallbackTextGenerationModelSelection(
          settings.providerInstances,
          (instanceId) => {
            const provider = snapshots.find((candidate) => candidate.instanceId === instanceId);
            return (
              instanceId !== selection.instanceId &&
              provider?.enabled === true &&
              resolveProjectProviderInstanceEnabled(settings, null, instanceId) &&
              provider.installed &&
              provider.auth.status !== "unauthenticated" &&
              isProviderAvailable(provider) &&
              isProviderTextGenerationCapable(provider) &&
              !exhaustedUsageWindow(provider, now)
            );
          },
          { includeConfiguredInstances: true },
        ) ?? selection;
    }
    return yield* resolveInstance(registry, operation, selection.instanceId).pipe(
      Effect.flatMap((service) => invoke(service, selection)),
    );
  });
  return TextGeneration.of({
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function (input) {
      return generate(
        "generateThreadTitle",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generateThreadTitle({ ...input, modelSelection }),
      );
    }),
  });
});

export const layer = Layer.effect(TextGeneration, make);
