import {
  ClaudeSettings,
  CodexSettings,
  type ProviderInstanceConfig,
  type ServerSettings,
  secretSettingsFields,
} from "@aprende/contracts";

function readSecretFieldValues(
  value: unknown,
): ReadonlyArray<readonly [serverHost: string | null, value: string]> {
  if (typeof value === "string") return [[null, value]];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([serverHost, entry]) =>
    typeof entry === "string" ? [[serverHost.trim().toLowerCase(), entry] as const] : [],
  );
}

function writeSecretFieldValues(
  original: unknown,
  values: ReadonlyArray<readonly [serverHost: string | null, value: string]>,
): unknown {
  if (typeof original === "string") return values[0]?.[1] ?? "";
  return Object.fromEntries(
    values.map(([serverHost, value]) => [serverHost ?? "", value] as const),
  );
}

const SECRET_REDACTED = "\u2022\u2022\u2022\u2022\u2022\u2022";

const providerSecretFields = new Map([
  ["codex", secretSettingsFields(CodexSettings)],
  ["claudeAgent", secretSettingsFields(ClaudeSettings)],
]);
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");

export interface SettingsSecret {
  readonly secretName: string;
  readonly kind: "field" | "environment";
  readonly value: string;
  readonly redacted: boolean;
  readonly sensitive: boolean;
  readonly providerInstanceId?: string;
  readonly environmentVariable?: string;
}

type SecretValue = Pick<SettingsSecret, "value" | "redacted">;
type SecretSlotName = (field: string, serverHost: string | null) => string;
type SecretFieldsMapper = (
  fields: Readonly<Record<string, unknown>>,
  secretFields: ReadonlyArray<string>,
  name: SecretSlotName,
) => Record<string, unknown>;
type ProviderEnvironment = NonNullable<ProviderInstanceConfig["environment"]>;

export function mapSettingsSecrets(
  settings: ServerSettings,
  map: (secret: SettingsSecret) => SecretValue,
): ServerSettings {
  const mapFields: SecretFieldsMapper = (fields, secretFields, name) => {
    const next = { ...fields };
    for (const field of secretFields) {
      if (!(field in next)) continue;
      next[field] = writeSecretFieldValues(
        next[field],
        readSecretFieldValues(next[field]).map(([serverHost, value]) => {
          const result = map({
            secretName: name(field, serverHost),
            kind: "field",
            value,
            redacted: value === SECRET_REDACTED,
            sensitive: true,
          });
          return [serverHost, result.redacted ? SECRET_REDACTED : result.value] as const;
        }),
      );
    }
    return next;
  };

  return mapSecretFieldGroups(settings, mapFields, (instanceId, environment) =>
    environment.map((variable) => {
      const { valueRedacted: _omit, ...rest } = variable;
      const result = map({
        secretName: `provider-env-${encode(instanceId)}-${encode(variable.name)}`,
        kind: "environment",
        value: variable.value,
        redacted: variable.valueRedacted === true,
        sensitive: variable.sensitive,
        providerInstanceId: instanceId,
        environmentVariable: variable.name,
      });
      return {
        ...rest,
        value: result.value,
        ...(result.redacted ? { valueRedacted: true } : {}),
      };
    }),
  );
}

function mapSecretFieldGroups(
  settings: ServerSettings,
  mapFields: SecretFieldsMapper,
  mapEnvironment: (instanceId: string, environment: ProviderEnvironment) => ProviderEnvironment = (
    _instanceId,
    environment,
  ) => environment,
): ServerSettings {
  const providerInstances = Object.fromEntries(
    Object.entries(settings.providerInstances).map(([instanceId, instance]) => {
      const config = instance.config;
      return [
        instanceId,
        {
          ...instance,
          ...(config !== null && typeof config === "object" && !Array.isArray(config)
            ? {
                config: mapFields(
                  config as Record<string, unknown>,
                  providerSecretFields.get(instance.driver) ?? [],
                  (field, serverHost) =>
                    `provider-config-${encode(instanceId)}-${encode(instance.driver)}-${encode(field)}` +
                    (serverHost === null ? "" : `-${encode(serverHost)}`),
                ),
              }
            : {}),
          ...(instance.environment
            ? { environment: mapEnvironment(instanceId, instance.environment) }
            : {}),
        },
      ];
    }),
  );

  return { ...settings, providerInstances };
}
