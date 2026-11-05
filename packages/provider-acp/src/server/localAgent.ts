import {
  defaultInstanceIdForDriver,
  makeProviderSettingsSchema,
  ProviderDriverKind,
  TrimmedString,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@aprende/contracts";
import * as HostProcess from "@aprende/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@aprende/shared/nodeRuntime";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import type * as McpProviderSessions from "@aprende/provider-core/server/McpProviderSessions";
import * as ProviderContinuationRequests from "@aprende/provider-core/server/ProviderContinuationRequests";
import type * as ProviderHost from "@aprende/provider-core/server/ProviderHost";
import * as ProviderEventLoggers from "@aprende/provider-core/server/ProviderEventLoggers";
import { mergeProviderInstanceEnvironment } from "@aprende/provider-core/server/instanceEnvironment";
import type * as IdAllocator from "@aprende/provider-core/server/IdAllocator";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@aprende/provider-core/server/adapterDriver";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2RuntimeInput,
} from "./adapter.ts";
import { makeAcpNativeLoggerFactory } from "./nativeLogging.ts";
import { findModelConfigOption } from "./runtimeModel.ts";
import { acpProviderOptionDescriptors, flattenSelectChoices } from "./sessionConfig.ts";

/**
 * Runs an ACP agent from a local command. Only the dev Replay provider uses it.
 * The kind predates this driver; saved Replay instances and recorded fixtures carry it.
 */
export const LOCAL_ACP_DRIVER = ProviderDriverKind.make("acpRegistry");
export const LOCAL_ACP_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(LOCAL_ACP_DRIVER);

export const LocalAcpSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    commandPath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({ title: "Executable" }),
    ),
    commandArgs: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  { order: ["commandPath"] },
);
export type LocalAcpSettings = typeof LocalAcpSettings.Type;

const DEFAULT_LOCAL_ACP_SETTINGS = Schema.decodeSync(LocalAcpSettings)({});

const MAX_MODELS = 256;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_COMMANDS = 128;

const boundedText = (value: string, maximumLength: number): string =>
  value.trim().slice(0, maximumLength);

const boundedOpaqueValue = (value: string, maximumLength: number): string | undefined =>
  value.length > 0 && value === value.trim() && value.length <= maximumLength ? value : undefined;

export interface LocalAcpModel {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface LocalAcpConfiguration {
  readonly models: ReadonlyArray<LocalAcpModel>;
  readonly currentModelId: string | null;
  readonly configOptions: ReturnType<typeof acpProviderOptionDescriptors>;
}

export interface LocalAcpCommands {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

function normalizedModel(id: string, candidate: LocalAcpModel): LocalAcpModel {
  return {
    id,
    name: boundedText(candidate.name, MAX_NAME_LENGTH) || id,
    description:
      candidate.description === null
        ? null
        : boundedText(candidate.description, MAX_DESCRIPTION_LENGTH) || null,
  };
}

function normalizeModels(
  candidates: ReadonlyArray<LocalAcpModel>,
  currentModelId: string | null,
): ReadonlyArray<LocalAcpModel> {
  const seen = new Set<string>();
  const models: Array<LocalAcpModel> = [];
  for (const candidate of candidates) {
    if (models.length === MAX_MODELS) break;
    const id = boundedOpaqueValue(candidate.id, MAX_ID_LENGTH);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    models.push(normalizedModel(id, candidate));
  }
  // Keep the running model visible even when its advertised position exceeds the cap.
  if (currentModelId !== null && models.length === MAX_MODELS && !seen.has(currentModelId)) {
    const current = candidates.find((candidate) => candidate.id === currentModelId);
    if (current !== undefined) {
      models[MAX_MODELS - 1] = normalizedModel(currentModelId, current);
    }
  }
  return models;
}

export function normalizeLocalAcpConfiguration(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  modeState?: Parameters<typeof acpProviderOptionDescriptors>[0]["modeState"],
  modelState?: EffectAcpSchema.SessionModelState | null,
): LocalAcpConfiguration {
  const modelOption = findModelConfigOption(configOptions);
  const currentModelId =
    modelOption?.type === "select" ? modelOption.currentValue : modelState?.currentModelId;
  const candidates =
    modelOption === undefined
      ? (modelState?.availableModels ?? []).map((model) => ({
          id: model.modelId,
          name: model.name,
          description: model.description ?? null,
        }))
      : flattenSelectChoices(modelOption.options).map((model) => ({
          id: model.value,
          name: model.name,
          description: model.description ?? null,
        }));
  const boundedCurrentModelId =
    currentModelId === undefined
      ? null
      : (boundedOpaqueValue(currentModelId, MAX_ID_LENGTH) ?? null);
  const models = normalizeModels(candidates, boundedCurrentModelId);
  return {
    models,
    currentModelId: models.some((model) => model.id === boundedCurrentModelId)
      ? boundedCurrentModelId
      : null,
    configOptions: acpProviderOptionDescriptors({ configOptions, modeState }),
  };
}

export function normalizeLocalAcpCommands(
  commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
): LocalAcpCommands {
  const seen = new Set<string>();
  const slashCommands: Array<ServerProviderSlashCommand> = [];
  const skills: Array<ServerProviderSkill> = [];
  let accepted = 0;
  for (const command of commands) {
    const name = boundedOpaqueValue(command.name, MAX_ID_LENGTH);
    if (name === undefined) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const description = boundedText(command.description, MAX_DESCRIPTION_LENGTH);
    const hint = command.input ? boundedText(command.input.hint, MAX_DESCRIPTION_LENGTH) : "";
    if (name.startsWith("$")) {
      const skillName = boundedOpaqueValue(name.slice(1), MAX_ID_LENGTH);
      if (skillName === undefined) continue;
      skills.push({
        name: skillName,
        ...(description ? { description } : {}),
        path: `acp://skill/${encodeURIComponent(skillName)}`,
        scope: "agent",
        enabled: true,
      });
    } else {
      slashCommands.push({
        name,
        ...(description ? { description } : {}),
        ...(hint ? { input: { hint } } : {}),
      });
    }
    accepted += 1;
    if (accepted === MAX_COMMANDS) break;
  }
  return { slashCommands, skills };
}

export function localAcpSpawn(
  settings: LocalAcpSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return { command: settings.commandPath, args: settings.commandArgs, cwd, env: environment };
}

export interface LocalAcpAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: LocalAcpSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  >;
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
}

function makeLocalAcpRuntime(options: LocalAcpAdapterV2Options) {
  return (
    input: AcpAdapterV2RuntimeInput,
  ): Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  > =>
    Effect.gen(function* () {
      const { processEnvironment, ...runtimeInput } = input;
      if (options.settings.commandPath.length === 0) {
        return yield* new EffectAcpErrors.AcpSpawnError({
          command: LOCAL_ACP_DRIVER,
          cause: new Error("The local ACP provider has no executable configured."),
        });
      }
      const context = yield* Layer.build(
        AcpSessionRuntime.layer({
          ...runtimeInput,
          spawn: localAcpSpawn(options.settings, input.cwd, {
            ...options.environment,
            ...processEnvironment,
          }),
        }),
      );
      return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(context),
      );
    });
}

export const makeLocalAcpAdapterV2 = Effect.fn("makeLocalAcpAdapterV2")(function* (
  options: LocalAcpAdapterV2Options,
) {
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: {
      driver: LOCAL_ACP_DRIVER,
      capabilities: AcpProviderCapabilitiesV2,
      makeRuntime: options.makeRuntime ?? makeLocalAcpRuntime(options),
      ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
    },
    selfInvocation: options.selfInvocation,
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
});

export type LocalAcpAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const LocalAcpAdapterV2Driver: ProviderAdapterDriver<
  LocalAcpSettings,
  LocalAcpAdapterV2DriverEnv
> = {
  driverKind: LOCAL_ACP_DRIVER,
  configSchema: LocalAcpSettings,
  defaultConfig: (): LocalAcpSettings => DEFAULT_LOCAL_ACP_SETTINGS,
  create: Effect.fn("LocalAcpAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<LocalAcpSettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeLocalAcpAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        continuationRequests: yield* ProviderContinuationRequests.ProviderContinuationRequests,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: LOCAL_ACP_DRIVER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: LOCAL_ACP_DRIVER,
              instanceId: input.instanceId,
              detail: "Failed to create the local ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
};
