import {
  DEFAULT_SERVER_SETTINGS,
  ModelSelection,
  ProjectId,
  ProjectScript,
  keepUnknownOverrideKeys,
  ProjectSettingsOverrides,
  type ProviderInstanceConfig,
  type ProviderInstanceMutation,
  defaultInstanceIdForDriver,
  isProviderDriverKind,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  ResponseStreamingMode,
  ServerSettings,
  ServerSettingsError,
  type ServerSettingsPatch,
  type ManagedPolicySummary,
  globalIdleCompaction,
  withIdleCompaction,
} from "@aprende/contracts";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Effect from "effect/Effect";
import * as NodeSqliteClient from "@aprende/shared/nodeSqliteClient";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { LOCAL_ACP_DRIVER } from "@aprende/provider-acp/server/localAgent";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { writeFileStringAtomically } from "@aprende/shared/atomicWrite";
import { resolveSymlinkTarget } from "@aprende/shared/symlink";
import * as ServerConfig from "./config.ts";
import { type DeepPartial, deepMerge } from "@aprende/shared/Struct";
import { fromJsonStringPretty, fromLenientJson } from "@aprende/shared/schemaJson";
import {
  applyServerSettingsPatch,
  deriveLegacyProjectOverrides,
  fallbackTextGenerationModelSelection,
  isModelSelectionProviderEnabled,
} from "@aprende/shared/serverSettings";
import * as ManagedPolicy from "./policy/ManagedPolicy.ts";

import {
  dropProviderCredentialVariables,
  findProviderCredentialVariable,
} from "./providerEnvironmentCredentials.ts";

const encodeServerSettings = Schema.encodeEffect(ServerSettings);
const encodeServerSettingsJson = Schema.encodeUnknownEffect(fromJsonStringPretty(ServerSettings));
const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);

// Conflicting flags resolve to false to preserve user disables.
const foldProviderInstanceEnabledFlags = (settings: ServerSettings): ServerSettings => {
  let changed = false;
  const providerInstances: Record<string, ProviderInstanceConfig> = {};
  for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
    const config = instance.config;
    // Leave malformed flags for driver schema validation rather than silently repairing them.
    if (
      config === null ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      typeof (config as { readonly enabled?: unknown }).enabled !== "boolean"
    ) {
      providerInstances[instanceId] = instance;
      continue;
    }
    const { enabled: configEnabled, ...restConfig } = config as Record<string, unknown> & {
      readonly enabled: boolean;
    };
    const resolved =
      instance.enabled === false || configEnabled === false
        ? false
        : (instance.enabled ?? configEnabled);
    changed = true;
    providerInstances[instanceId] = {
      ...instance,
      enabled: resolved,
      config: restConfig,
    } satisfies ProviderInstanceConfig;
  }
  if (!changed) {
    return settings;
  }
  return {
    ...settings,
    providerInstances: providerInstances as ServerSettings["providerInstances"],
  };
};

const normalizeServerSettings = (
  settings: ServerSettings,
): Effect.Effect<ServerSettings, ServerSettingsError> =>
  encodeServerSettings(settings).pipe(
    Effect.flatMap(decodeServerSettings),
    Effect.map(foldProviderInstanceEnabledFlags),
    Effect.map((next) => withIdleCompaction(next, globalIdleCompaction(next))),
    Effect.map((next) => ({ ...next, ...deriveLegacyProjectOverrides(next) })),
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath: "<memory>",
          operation: "normalize",
          cause,
        }),
    ),
  );

export function applyProviderInstanceMutation(
  settings: ServerSettings,
  mutation: ProviderInstanceMutation,
): ServerSettings {
  const providerInstances = { ...settings.providerInstances };
  if (mutation.operation === "upsert" || mutation.operation === "create") {
    providerInstances[mutation.instanceId] = mutation.instance;
  } else {
    delete providerInstances[mutation.instanceId];
  }
  return { ...settings, providerInstances };
}

function ensureProviderInstanceMutationAllowed(
  settings: ServerSettings,
  mutation: ProviderInstanceMutation,
  settingsPath: string,
): Effect.Effect<void, ServerSettingsError> {
  if (
    mutation.operation === "create" &&
    settings.providerInstances[mutation.instanceId] !== undefined
  ) {
    return Effect.fail(
      new ServerSettingsError({
        settingsPath,
        operation: "create-provider-instance",
        providerInstanceId: mutation.instanceId,
      }),
    );
  }
  return Effect.void;
}

export class ServerSettingsService extends Context.Service<
  ServerSettingsService,
  {
    readonly start: Effect.Effect<void, ServerSettingsError>;

    readonly ready: Effect.Effect<void, ServerSettingsError>;

    /** The administrator's policy as clients see it; absent when unmanaged. */
    readonly managedPolicy?: ManagedPolicySummary | undefined;

    readonly getSettings: Effect.Effect<ServerSettings, ServerSettingsError>;

    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => Effect.Effect<ServerSettings, ServerSettingsError>;

    readonly updateProviderInstance: (
      mutation: ProviderInstanceMutation,
      patch?: ServerSettingsPatch,
    ) => Effect.Effect<ServerSettings, ServerSettingsError>;

    readonly withSettingsSnapshot: <A, E, R>(
      use: (settings: ServerSettings) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ServerSettingsError, R>;

    readonly streamChanges: Stream.Stream<ServerSettings>;

    /** Subscribe before reading a snapshot to retain changes before lazy stream startup. */
    readonly subscribeChanges: Effect.Effect<Stream.Stream<ServerSettings>, never, Scope.Scope>;
  }
>()("aprende/serverSettings/ServerSettingsService") {
  static readonly layerTest = (
    overrides: DeepPartial<ServerSettings> = {},
    managedPolicy?: ManagedPolicySummary,
  ) => layerTest(overrides, managedPolicy);
}

const makeTest = Effect.fn("serverSettings.makeTest")(function* (
  overrides: DeepPartial<ServerSettings> = {},
  managedPolicy?: ManagedPolicySummary,
) {
  const { providerHealthRefreshInterval, ...overridesForMerge } = overrides;
  const merged = deepMerge(DEFAULT_SERVER_SETTINGS, overridesForMerge);
  const initialSettings = yield* normalizeServerSettings({
    ...merged,
    ...(providerHealthRefreshInterval !== undefined
      ? { providerHealthRefreshInterval: providerHealthRefreshInterval as Duration.Duration }
      : {}),
  });
  const currentSettingsRef = yield* Ref.make<ServerSettings>(initialSettings);
  const writeSemaphore = yield* Semaphore.make(1);
  const getSettings = Ref.get(currentSettingsRef).pipe(Effect.map(resolveTextGenerationProvider));

  const updateTestSettings = (
    update: (current: ServerSettings) => Effect.Effect<ServerSettings, ServerSettingsError>,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    writeSemaphore.withPermits(1)(
      Ref.get(currentSettingsRef).pipe(
        Effect.flatMap(update),
        Effect.flatMap(normalizeServerSettings),
        Effect.tap((nextSettings) => Ref.set(currentSettingsRef, nextSettings)),
        Effect.map(resolveTextGenerationProvider),
      ),
    );

  return {
    managedPolicy,
    start: Effect.void,
    ready: Effect.void,
    getSettings,
    updateSettings: (patch) =>
      updateTestSettings((currentSettings) =>
        Effect.succeed(applyServerSettingsPatch(currentSettings, patch)),
      ),
    updateProviderInstance: (mutation, patch = {}) =>
      updateTestSettings((currentSettings) =>
        Effect.gen(function* () {
          yield* ensureProviderInstanceMutationAllowed(currentSettings, mutation, "test settings");
          const patched = applyServerSettingsPatch(currentSettings, patch);
          return applyProviderInstanceMutation(patched, mutation);
        }),
      ),
    withSettingsSnapshot: (use) =>
      writeSemaphore.withPermits(1)(getSettings.pipe(Effect.flatMap(use))),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.succeed(Stream.empty),
  } satisfies ServerSettingsService["Service"];
});

/** Test settings; `managedPolicy` only tells consumers a policy applies, it does not lock values. */
export const layerTest = (
  overrides: DeepPartial<ServerSettings> = {},
  managedPolicy?: ManagedPolicySummary,
) => Layer.effect(ServerSettingsService, makeTest(overrides, managedPolicy));

// Accept retired token delivery only on load so one old value cannot reset all settings.
const PersistedResponseStreamingMode = Schema.Union([
  ResponseStreamingMode,
  Schema.Literal("token"),
]).pipe(
  Schema.decodeTo(
    ResponseStreamingMode,
    SchemaTransformation.transform({
      decode: (mode) => (mode === "token" ? "paragraph" : mode),
      encode: (mode) => mode,
    }),
  ),
);
const PersistedServerSettings = Schema.Struct({
  ...ServerSettings.fields,
  responseStreamingMode: PersistedResponseStreamingMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("paragraph" as const)),
  ),
  projectSettingsOverrides: Schema.Record(
    ProjectId,
    keepUnknownOverrideKeys(
      Schema.Struct({
        ...ProjectSettingsOverrides.fields,
        responseStreamingMode: Schema.optionalKey(PersistedResponseStreamingMode),
      }),
    ),
  ).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
// Parse first and decode second, so a managed policy can fill its defaults in between.
const decodeSettingsFileJsonExit = Schema.decodeUnknownExit(fromLenientJson(Schema.Unknown));
const decodePersistedServerSettingsExit = Schema.decodeUnknownExit(PersistedServerSettings);
const LegacyProviderSettingsJson = fromLenientJson(
  Schema.Struct({
    providers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    bitbucket: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    github: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const decodeLegacyProviderSettingsJsonExit = Schema.decodeUnknownExit(LegacyProviderSettingsJson);

function migrateLegacyProviderSettings(
  settings: ServerSettings,
  legacyProviders: Readonly<Record<string, unknown>>,
): ServerSettings {
  const providerInstances: Record<ProviderInstanceId, ProviderInstanceConfig> = {
    ...settings.providerInstances,
  };
  for (const [kind, blob] of Object.entries(legacyProviders)) {
    if (!isProviderDriverKind(kind) || blob === null || typeof blob !== "object") continue;
    if (Array.isArray(blob)) continue;
    const driver = kind;
    const instanceId = defaultInstanceIdForDriver(driver);
    if (Object.hasOwn(providerInstances, instanceId)) continue;

    const { enabled: rawEnabled, ...config } = blob as Record<string, unknown>;
    const enabled = typeof rawEnabled === "boolean" ? rawEnabled : undefined;
    const driverDefault = resolveProviderInstanceEnabled({ driver, config: {} });
    if (Object.keys(config).length === 0 && (enabled === undefined || enabled === driverDefault)) {
      continue;
    }
    providerInstances[instanceId] = {
      driver,
      ...(enabled === undefined ? {} : { enabled }),
      config,
    } satisfies ProviderInstanceConfig;
  }

  return {
    ...settings,
    providerInstances,
  };
}

function selectionSupportsTextGeneration(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  return settings.providerInstances[selection.instanceId]?.driver !== LOCAL_ACP_DRIVER;
}

type DriverAllowed = (driver: ProviderDriverKind) => boolean;
const anyDriver: DriverAllowed = () => true;

function resolveTextGenerationProvider(
  settings: ServerSettings,
  isDriverAllowed: DriverAllowed = anyDriver,
): ServerSettings {
  const selection = settings.textGenerationModelSelection;
  return isModelSelectionProviderEnabled(settings, selection) &&
    selectionSupportsTextGeneration(settings, selection) &&
    isDriverAllowed(
      settings.providerInstances[selection.instanceId]?.driver ??
        ProviderDriverKind.make(selection.instanceId),
    )
    ? settings
    : fallbackTextGenerationProvider(settings, isDriverAllowed);
}

function fallbackTextGenerationProvider(
  settings: ServerSettings,
  isDriverAllowed: DriverAllowed,
): ServerSettings {
  const fallback = fallbackTextGenerationModelSelection(
    settings.providerInstances,
    (instanceId, driver) =>
      // A default instance id can be configured with another driver.
      isDriverAllowed(settings.providerInstances[instanceId]?.driver ?? driver) &&
      resolveProviderInstanceEnabled(
        settings.providerInstances[instanceId] ?? { driver, config: {} },
      ),
    { defaultModelSelection: settings.defaultModelSelection },
  );
  return fallback === null ? settings : { ...settings, textGenerationModelSelection: fallback };
}

const ATOMIC_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "backgroundActivity",
  "providerHealthRefreshInterval",
  "textGenerationModelSelection",
  "fallbackModelSelection",
  // Empty by default, these hold one whole value, which a managed policy can default.
  ...Object.entries(DEFAULT_SERVER_SETTINGS).flatMap(([key, value]) =>
    value === null ? [key] : [],
  ),
]);

function stripDefaultServerSettings(current: unknown, defaults: unknown): unknown | undefined {
  if (Array.isArray(current) || Array.isArray(defaults)) {
    return Equal.equals(current, defaults) ? undefined : current;
  }

  if (
    current !== null &&
    defaults !== null &&
    typeof current === "object" &&
    typeof defaults === "object"
  ) {
    const currentRecord = current as Record<string, unknown>;
    const defaultsRecord = defaults as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(currentRecord)) {
      if (ATOMIC_SETTINGS_KEYS.has(key)) {
        if (!Equal.equals(currentRecord[key], defaultsRecord[key])) {
          next[key] = currentRecord[key];
        }
      } else {
        const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key]);
        if (stripped !== undefined) {
          next[key] = stripped;
        }
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  return Object.is(current, defaults) ? undefined : current;
}

const decodeProjectScriptsJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(ProjectScript)),
);
const decodeModelSelectionJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.NullOr(ModelSelection)),
);

interface LegacyProjectSettingsRow {
  readonly projectId: string;
  readonly defaultModelSelection: string | null;
  readonly scripts: string;
}

// projectSettingsFolded prevents restarts from undoing later UI resets.
function foldLegacyProjectSettings(
  settings: ServerSettings,
  rows: ReadonlyArray<LegacyProjectSettingsRow>,
): ServerSettings {
  if (settings.projectSettingsFolded) return settings;
  if (rows.length === 0 && Object.keys(settings.projectScriptOverrides).length === 0) {
    return settings;
  }
  const entries: Record<string, ProjectSettingsOverrides> = {
    ...settings.projectSettingsOverrides,
  };
  const set = <K extends keyof ProjectSettingsOverrides>(
    projectId: string,
    key: K,
    value: ProjectSettingsOverrides[K] | undefined,
  ) => {
    if (value === undefined) return;
    const entry = entries[projectId] ?? {};
    if (Object.hasOwn(entry, key)) return;
    entries[projectId] = { ...entry, [key]: value };
  };
  // A stored null resets to machine defaults, so the project's aggregate scripts must not resurface.
  const resetScripts = new Set<string>();
  for (const [projectId, value] of Object.entries(settings.projectScriptOverrides)) {
    if (value === null) resetScripts.add(projectId);
    else set(projectId, "defaultProjectScripts", value);
  }
  for (const row of rows) {
    const model = decodeModelSelectionJson(row.defaultModelSelection ?? "null");
    if (Option.isSome(model) && model.value !== null) {
      set(row.projectId, "defaultModelSelection", model.value);
    }
    const scripts = decodeProjectScriptsJson(row.scripts);
    if (Option.isSome(scripts) && scripts.value.length > 0 && !resetScripts.has(row.projectId)) {
      set(row.projectId, "defaultProjectScripts", scripts.value);
    }
  }
  const projectSettingsOverrides = Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => Object.keys(entry).length > 0),
  );
  return {
    ...settings,
    projectSettingsOverrides,
    projectSettingsFolded: true,
    ...deriveLegacyProjectOverrides({ projectSettingsOverrides }),
  };
}

const make = Effect.gen(function* () {
  const { settingsPath } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const {
    settings: managed,
    providers: managedProviders,
    summary: managedPolicy,
  } = yield* ManagedPolicy.ManagedPolicy;
  // Locks are laid over every settings value that leaves this service, never persisted.
  const toEffective = (settings: ServerSettings) =>
    resolveTextGenerationProvider(
      managedProviders.applyLimits(managed.applyLocks(settings)),
      managedProviders.isDriverAllowed,
    );
  const writeSemaphore = yield* Semaphore.make(1);
  const cacheKey = "settings" as const;
  const changesPubSub = yield* PubSub.unbounded<ServerSettings>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ServerSettingsError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const emitChange = (settings: ServerSettings) =>
    PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          operation: "check-exists",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          operation: "read-file",
          cause,
        }),
    ),
  );

  // The file before this write, parsed; only read when policy defaults need it.
  const readStoredSettings = Effect.gen(function* () {
    if (!(yield* readConfigExists)) return undefined;
    const parsed = decodeSettingsFileJsonExit(yield* readRawConfig);
    return Exit.isSuccess(parsed) ? parsed.value : undefined;
  });

  const writeSettingsAtomically = Effect.fnUntraced(
    function* (settings: ServerSettings) {
      const stripped = stripDefaultServerSettings(settings, managed.defaults) ?? {};
      const sparseSettingsJson = yield* encodeServerSettingsJson(
        managed.keepStored === undefined
          ? stripped
          : managed.keepStored(stripped, settings, yield* readStoredSettings, (key) =>
              ATOMIC_SETTINGS_KEYS.has(key),
            ),
      );

      return yield* writeFileStringAtomically({
        filePath: settingsPath,
        contents: `${sparseSettingsJson}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
      );
    },
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          operation: "write-file",
          cause,
        }),
    ),
  );

  const loadSettingsFromDisk = Effect.gen(function* () {
    let settings = managed.defaults;
    let legacyProviders: Readonly<Record<string, unknown>> | undefined;
    let parseFailure = Option.none<unknown>();
    let credentialsScrubbed = false;

    if (yield* readConfigExists) {
      const raw = yield* readRawConfig;
      const parsed = decodeSettingsFileJsonExit(raw);
      const scrubbed = Exit.isFailure(parsed)
        ? undefined
        : dropProviderCredentialVariables(parsed.value);
      const decoded = Exit.isFailure(parsed)
        ? parsed
        : decodePersistedServerSettingsExit(
            managed.withDefaults(scrubbed?.settings ?? parsed.value),
          );
      if (scrubbed !== undefined && Exit.isSuccess(parsed)) {
        credentialsScrubbed = scrubbed.settings !== parsed.value;
        if (scrubbed.dropped.length > 0) {
          yield* Effect.logWarning("removed provider variables that held credentials", {
            path: settingsPath,
            variables: scrubbed.dropped.map(
              (variable) => `${variable.instanceId}.${variable.name}`,
            ),
          });
        }
      }
      const legacySettings = decodeLegacyProviderSettingsJsonExit(raw);
      if (legacySettings._tag === "Success") {
        legacyProviders = legacySettings.value.providers;
      }
      if (decoded._tag === "Failure" || legacySettings._tag === "Failure") {
        const failure = decoded._tag === "Failure" ? decoded : legacySettings;
        // The file may hold an opt-out we can no longer read; never resume threads on a guess.
        settings = { ...managed.defaults, continueThreadsAfterServerUpdate: false };
        if (failure._tag === "Failure") {
          parseFailure = Option.some(Cause.squash(failure.cause));
          yield* Effect.logWarning("failed to parse settings.json, using defaults", {
            path: settingsPath,
            issues: Cause.pretty(failure.cause),
            cause: failure.cause,
          });
        }
      } else {
        settings = decoded.value;
      }
    }
    // Settings saved by a server that kept the mode in `compactIdleThreads` move
    // it to `idleCompaction`, so that switch goes to clients as a boolean. The
    // defaults gain the field too, which tells clients this server reads modes.
    settings = withIdleCompaction(settings, globalIdleCompaction(settings));

    // A file that failed to decode must stay on disk for the user to repair.
    const settingsFileTrusted = Option.isNone(parseFailure);
    const legacyProjectRows =
      settings.projectSettingsFolded || !settingsFileTrusted
        ? []
        : yield* sql<LegacyProjectSettingsRow>`
          SELECT
            project_id AS "projectId",
            default_model_selection_json AS "defaultModelSelection",
            scripts_json AS "scripts"
          FROM projection_projects
          WHERE deleted_at IS NULL
        `.pipe(
            NodeSqliteClient.readOnly,
            Effect.mapError(
              (cause) =>
                new ServerSettingsError({
                  settingsPath,
                  operation: "read-project-settings",
                  cause,
                }),
            ),
          );

    const loaded = foldProviderInstanceEnabledFlags(
      legacyProviders === undefined
        ? settings
        : migrateLegacyProviderSettings(settings, legacyProviders),
    );
    const folded = settingsFileTrusted
      ? foldLegacyProjectSettings(loaded, legacyProjectRows)
      : loaded;
    if (
      folded !== loaded ||
      (settingsFileTrusted && (credentialsScrubbed || legacyProviders !== undefined))
    ) {
      yield* writeSettingsAtomically(folded);
    }
    return { settings: folded, parseFailure };
  });

  const settingsCache = yield* Cache.makeWith((_key: typeof cacheKey) => loadSettingsFromDisk, {
    capacity: 1,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  });

  const getSettingsFromCache = Cache.get(settingsCache, cacheKey).pipe(
    Effect.map((loaded) => loaded.settings),
  );
  const reloadSettings = Cache.invalidate(settingsCache, cacheKey).pipe(
    Effect.andThen(Cache.get(settingsCache, cacheKey)),
  );

  const getEffectiveSettings = getSettingsFromCache.pipe(Effect.map(toEffective));

  const updateAndPersistSettings = (
    patch: ServerSettingsPatch,
    update: (current: ServerSettings) => Effect.Effect<ServerSettings, ServerSettingsError>,
  ): Effect.Effect<ServerSettings, ServerSettingsError> =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const { settings: current, parseFailure } = yield* reloadSettings;
        if (Option.isSome(parseFailure)) {
          return yield* new ServerSettingsError({
            settingsPath,
            operation: "read-file",
            cause: parseFailure.value,
          });
        }
        const updated = yield* update(current);
        const credential = findProviderCredentialVariable(updated);
        if (credential !== undefined) {
          return yield* new ServerSettingsError({
            settingsPath,
            operation: "save-credential-variable",
            providerInstanceId: credential.instanceId,
            environmentVariable: credential.name,
          });
        }
        const vetted = managed.vetWrite(current, yield* normalizeServerSettings(updated), patch);
        if (vetted._tag === "Locked") {
          return yield* new ServerSettingsError({
            settingsPath,
            operation: "write-managed-setting",
            managedSetting: vetted.path,
            managedBy: managedPolicy?.organization,
          });
        }
        const vettedProviders = managedProviders.vetWrite(current, vetted.settings);
        if (vettedProviders._tag === "Locked") {
          return yield* new ServerSettingsError({
            settingsPath,
            operation: "write-managed-setting",
            managedSetting: vettedProviders.path,
            managedBy: managedPolicy?.organization,
          });
        }
        if (vettedProviders._tag === "Disallowed") {
          return yield* new ServerSettingsError({
            settingsPath,
            operation: "use-disallowed-provider",
            providerInstanceId: vettedProviders.instanceId,
            providerLabel: vettedProviders.label,
            managedBy: managedPolicy?.organization,
          });
        }
        const next = yield* normalizeServerSettings(vettedProviders.settings);
        yield* writeSettingsAtomically(next);
        yield* Cache.set(settingsCache, cacheKey, { settings: next, parseFailure: Option.none() });
        yield* emitChange(next);
        return toEffective(next);
      }),
    );

  const withSettingsSnapshot: ServerSettingsService["Service"]["withSettingsSnapshot"] = (use) =>
    writeSemaphore.withPermits(1)(getEffectiveSettings.pipe(Effect.flatMap(use)));

  const revalidateAndEmit = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const { settings } = yield* reloadSettings;
      yield* emitChange(settings);
    }),
  );

  const watchFileChanges = (filePath: string) => {
    const directory = pathService.dirname(filePath);
    const fileName = pathService.basename(filePath);
    const resolvedFilePath = pathService.resolve(filePath);
    return fs
      .watch(directory)
      .pipe(
        Stream.filter(
          (event) =>
            event.path === fileName ||
            event.path === filePath ||
            pathService.resolve(directory, event.path) === resolvedFilePath,
        ),
      );
  };

  const startWatcher = Effect.gen(function* () {
    const settingsDir = pathService.dirname(settingsPath);

    yield* fs.makeDirectory(settingsDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            operation: "prepare-directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    // Watch symlink targets' directories for rewrites; re-resolve link changes to follow repointing.
    const watchLinkTarget = Effect.gen(function* () {
      const linkTargetPath = yield* resolveSymlinkTarget(settingsPath).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
      );
      if (linkTargetPath === pathService.resolve(settingsPath)) {
        return Option.none<string>();
      }
      yield* fs
        .makeDirectory(pathService.dirname(linkTargetPath), { recursive: true })
        .pipe(Effect.ignore({ log: true }));
      return Option.some(linkTargetPath);
    }).pipe(Effect.orElseSucceed(() => Option.none<string>()));

    const initialLinkTarget = yield* watchLinkTarget;
    const linkTargetEvents = Stream.make(initialLinkTarget).pipe(
      Stream.concat(watchFileChanges(settingsPath).pipe(Stream.mapEffect(() => watchLinkTarget))),
      Stream.changes,
      Stream.switchMap(
        Option.match({
          onNone: () => Stream.empty,
          onSome: (linkTargetPath) =>
            watchFileChanges(linkTargetPath).pipe(Stream.ignore({ log: true })),
        }),
      ),
    );

    // Saves emit multiple events; fs.watch may fire before content is flushed.
    const debouncedSettingsEvents = Stream.merge(
      watchFileChanges(settingsPath),
      linkTargetEvents,
    ).pipe(Stream.debounce(Duration.millis(100)));

    yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true]);
    if (!shouldStart) {
      return yield* Deferred.await(startedDeferred);
    }

    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* reloadSettings;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    managedPolicy,
    start,
    ready: Deferred.await(startedDeferred),
    getSettings: getEffectiveSettings,
    updateSettings: (patch) =>
      updateAndPersistSettings(patch, (current) =>
        Effect.succeed(applyServerSettingsPatch(current, patch)),
      ),
    updateProviderInstance: (mutation, patch = {}) =>
      updateAndPersistSettings(patch, (current) =>
        Effect.gen(function* () {
          yield* ensureProviderInstanceMutationAllowed(current, mutation, settingsPath);
          const patched = applyServerSettingsPatch(current, patch);
          return applyProviderInstanceMutation(patched, mutation);
        }),
      ),
    withSettingsSnapshot,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub).pipe(Stream.map(toEffective));
    },
    get subscribeChanges() {
      return PubSub.subscribe(changesPubSub).pipe(
        Effect.map((subscription) =>
          Stream.fromSubscription(subscription).pipe(Stream.map(toEffective)),
        ),
      );
    },
  } satisfies ServerSettingsService["Service"];
});

export const layer = Layer.effect(ServerSettingsService, make);
