import { isCredentialEnvironmentVariableName, type ServerSettings } from "@aprende/contracts";

export interface DroppedProviderVariable {
  readonly instanceId: string;
  readonly name: string;
  /** Earlier builds stored `sensitive` values in the secret store and left the file's value empty. */
  readonly reason: "sensitive" | "credentialName";
  readonly hadValue: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Removes provider variables that hold credentials from a raw settings tree, and the
 * `sensitive`/`valueRedacted` flags earlier builds wrote. Returns the input when nothing changes.
 */
export function dropProviderCredentialVariables(raw: unknown): {
  readonly settings: unknown;
  readonly dropped: ReadonlyArray<DroppedProviderVariable>;
} {
  if (!isRecord(raw) || !isRecord(raw.providerInstances)) return { settings: raw, dropped: [] };
  const dropped: DroppedProviderVariable[] = [];
  let changed = false;
  const providerInstances = Object.fromEntries(
    Object.entries(raw.providerInstances).map(([instanceId, instance]) => {
      if (!isRecord(instance) || !Array.isArray(instance.environment)) {
        return [instanceId, instance];
      }
      const environment = instance.environment.flatMap((variable: unknown) => {
        if (!isRecord(variable)) return [variable];
        const name = typeof variable.name === "string" ? variable.name : "";
        const hadValue = typeof variable.value === "string" && variable.value.length > 0;
        const reason =
          variable.sensitive === true
            ? "sensitive"
            : isCredentialEnvironmentVariableName(name)
              ? "credentialName"
              : undefined;
        if (reason !== undefined) {
          dropped.push({ instanceId, name, reason, hadValue });
          changed = true;
          return [];
        }
        if (!("sensitive" in variable) && !("valueRedacted" in variable)) return [variable];
        const { sensitive: _sensitive, valueRedacted: _valueRedacted, ...plain } = variable;
        changed = true;
        return [plain];
      });
      return [instanceId, { ...instance, environment }];
    }),
  );
  return changed
    ? { settings: { ...raw, providerInstances }, dropped }
    : { settings: raw, dropped: [] };
}

export function findProviderCredentialVariable(
  settings: ServerSettings,
): { readonly instanceId: string; readonly name: string } | undefined {
  for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
    const variable = instance.environment?.find((entry) =>
      isCredentialEnvironmentVariableName(entry.name),
    );
    if (variable !== undefined) return { instanceId, name: variable.name };
  }
  return undefined;
}
