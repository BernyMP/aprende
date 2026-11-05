import { TextGenerationError, type ServerProvider } from "@aprende/contracts";
import * as HostProcess from "@aprende/shared/HostProcess";
import { createModelCapabilities } from "@aprende/shared/model";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProviderHost from "@aprende/provider-core/server/ProviderHost";
import { ProviderDriverError } from "@aprende/provider-core/server/errors";
import { makeManagedServerProvider } from "@aprende/provider-core/server/managedProvider";
import { mergeProviderInstanceEnvironment } from "@aprende/provider-core/server/instanceEnvironment";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@aprende/provider-core/server/driver";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@aprende/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@aprende/provider-core/server/snapshotSettings";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { parseSessionModeState } from "./runtimeModel.ts";
import {
  LOCAL_ACP_DRIVER,
  LocalAcpAdapterV2Driver,
  type LocalAcpAdapterV2DriverEnv,
  type LocalAcpCommands,
  type LocalAcpConfiguration,
  LocalAcpSettings,
  localAcpSpawn,
  normalizeLocalAcpCommands,
  normalizeLocalAcpConfiguration,
} from "./localAgent.ts";

const decodeSettings = Schema.decodeSync(LocalAcpSettings);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: LOCAL_ACP_DRIVER,
  packageName: null,
});
const PROBE_TIMEOUT = "60 seconds";
const COMMAND_ADVERTISEMENT_GRACE = "500 millis";

export interface LocalAcpProbe {
  readonly configuration: LocalAcpConfiguration;
  readonly commands: LocalAcpCommands;
}

/** Starts the agent, opens one session to read its models and commands, then stops it. */
export const probeLocalAcpAgent = Effect.fn("LocalAcpDriver.probe")(function* (input: {
  readonly settings: LocalAcpSettings;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const random = yield* SecureRandom.SecureRandom;
  return yield* Effect.gen(function* () {
    const runtimeContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        spawn: localAcpSpawn(input.settings, input.cwd, input.environment),
        cwd: input.cwd,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "aprende-provider-test", version: "0.0.0" },
        authenticateOnAuthRequired: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Layer.succeed(SecureRandom.SecureRandom, random),
          ),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(runtimeContext),
    );
    const commandsRef = yield* Ref.make<LocalAcpCommands>({ slashCommands: [], skills: [] });
    const commandsAdvertised = yield* Deferred.make<void>();
    yield* runtime.handleSessionUpdate(({ update }) =>
      update.sessionUpdate === "available_commands_update"
        ? Ref.set(commandsRef, normalizeLocalAcpCommands(update.availableCommands)).pipe(
            Effect.andThen(Deferred.succeed(commandsAdvertised, undefined)),
            Effect.asVoid,
          )
        : Effect.void,
    );
    const started = yield* runtime.start();
    yield* Deferred.await(commandsAdvertised).pipe(
      Effect.timeoutOption(COMMAND_ADVERTISEMENT_GRACE),
    );
    return {
      configuration: normalizeLocalAcpConfiguration(
        started.sessionSetupResult.configOptions ?? [],
        parseSessionModeState(started.sessionSetupResult),
        started.sessionSetupResult.models,
      ),
      commands: yield* Ref.get(commandsRef),
    } satisfies LocalAcpProbe;
  }).pipe(Effect.scoped, Effect.timeout(PROBE_TIMEOUT));
});

function localAcpModels(
  configuration: LocalAcpConfiguration | undefined,
): ServerProvider["models"] {
  const capabilities = createModelCapabilities({
    optionDescriptors: configuration?.configOptions ?? [],
  });
  const models = configuration?.models ?? [];
  if (models.length === 0) {
    return [{ slug: "default", name: "Default", isCustom: false, isDefault: true, capabilities }];
  }
  return models.map((model) => ({
    slug: model.id,
    name: model.name,
    isCustom: false,
    ...(model.id === configuration?.currentModelId ? { isDefault: true } : {}),
    capabilities,
  }));
}

function buildLocalAcpSnapshot(input: {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly continuationKey: string;
  readonly settings: LocalAcpSettings;
  readonly checkedAt: string;
  readonly result:
    | { readonly status: "checking" }
    | { readonly status: "ready"; readonly probe: LocalAcpProbe }
    | { readonly status: "error"; readonly message: string };
}): ServerProvider {
  const { result, settings } = input;
  const ready = result.status === "ready";
  return {
    instanceId: input.instanceId,
    driver: LOCAL_ACP_DRIVER,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationKey },
    supportsTextGeneration: false,
    enabled: settings.enabled,
    installed: ready,
    version: null,
    status: !settings.enabled
      ? "disabled"
      : ready
        ? "ready"
        : result.status === "checking"
          ? "warning"
          : "error",
    auth: { status: "unknown", canLogout: false },
    checkedAt: input.checkedAt,
    setup: { canInstall: false, canAuthenticate: false },
    ...(result.status === "checking"
      ? { message: "Checking the local ACP agent..." }
      : result.status === "error"
        ? { message: result.message }
        : {}),
    models: localAcpModels(ready ? result.probe.configuration : undefined),
    slashCommands: ready ? result.probe.commands.slashCommands : [],
    skills: ready ? result.probe.commands.skills : [],
  };
}

const makeUnsupportedTextGeneration = (): ProviderInstance["textGeneration"] => ({
  generateThreadTitle: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Local ACP agents do not provide application text generation.",
      }),
    ),
});

export type LocalAcpDriverEnv = LocalAcpAdapterV2DriverEnv;

export const LocalAcpDriver: ProviderDriver<LocalAcpSettings, LocalAcpDriverEnv> = {
  driverKind: LOCAL_ACP_DRIVER,
  metadata: {
    displayName: "Local ACP agent",
    supportsMultipleInstances: true,
    hasDefaultInstance: false,
  },
  configSchema: LocalAcpSettings,
  defaultConfig: () => decodeSettings({}),
  create: Effect.fn("LocalAcpDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const random = yield* SecureRandom.SecureRandom;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const host = yield* ProviderHost.ProviderHost;
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: LOCAL_ACP_DRIVER,
      instanceId,
    });
    const settings = { ...config, enabled } satisfies LocalAcpSettings;
    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      yield* HostProcess.Environment,
    );
    const orchestrationAdapter = yield* LocalAcpAdapterV2Driver.create({
      instanceId,
      displayName,
      accentColor,
      environment,
      enabled,
      config,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: LOCAL_ACP_DRIVER,
            instanceId,
            detail: "Failed to build the local ACP orchestration adapter.",
            cause,
          }),
      ),
    );
    const snapshotFor = (result: Parameters<typeof buildLocalAcpSnapshot>[0]["result"]) =>
      DateTime.now.pipe(
        Effect.map((now) =>
          buildLocalAcpSnapshot({
            instanceId,
            displayName,
            accentColor,
            continuationKey: continuationIdentity.continuationKey,
            settings,
            checkedAt: DateTime.formatIso(now),
            result,
          }),
        ),
      );
    const checkProvider = Effect.gen(function* () {
      if (!settings.enabled) return yield* snapshotFor({ status: "checking" });
      if (settings.commandPath.length === 0) {
        return yield* snapshotFor({
          status: "error",
          message: "Set the executable that starts this ACP agent.",
        });
      }
      return yield* probeLocalAcpAgent({
        settings,
        cwd: host.paths.cwd,
        environment: processEnvironment,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(SecureRandom.SecureRandom, random),
        Effect.matchEffect({
          onFailure: (error) =>
            snapshotFor({
              status: "error",
              message: `The local ACP agent could not start a session: ${error.message}`,
            }),
          onSuccess: (probe) => snapshotFor({ status: "ready", probe }),
        }),
      );
    });
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(settings);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<LocalAcpSettings>>({
      resolveMaintenance: () => Effect.succeed(MAINTENANCE),
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: () => snapshotFor({ status: "checking" }),
      checkProvider,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: LOCAL_ACP_DRIVER,
            instanceId,
            detail: "Failed to build the local ACP provider snapshot.",
            cause,
          }),
      ),
    );

    return {
      instanceId,
      driverKind: LOCAL_ACP_DRIVER,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      orchestrationAdapter,
      textGeneration: makeUnsupportedTextGeneration(),
    } satisfies ProviderInstance;
  }),
};
