import type { ServerSettings } from "@aprende/contracts";
import { expandHomePath } from "@aprende/provider-core/server/pathExpansion";
import * as HostProcess from "@aprende/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

// Earlier builds kept ChatGPT tokens and client registrations (provider-auth), sensitive
// provider variables (provider-env) and masked config fields (provider-config) here.
const LEGACY_SECRET_FILE = /^provider-(?:auth|env|config)-[\w-]+\.bin$/;

const configuredCodexHomes = (settings: ServerSettings, path: Path.Path, home: string) =>
  new Set(
    Object.values(settings.providerInstances).flatMap((instance) => {
      const config = instance.config;
      if (config === null || typeof config !== "object") return [];
      return ["homePath", "shadowHomePath"].flatMap((field) => {
        const value: unknown = (config as Record<string, unknown>)[field];
        return typeof value === "string" && value.trim()
          ? [path.resolve(expandHomePath(value.trim(), home))]
          : [];
      });
    }),
  );

/**
 * Learners sign in through their own CLI, so aprende deletes the credentials and managed Codex
 * homes earlier builds stored. Runs at every startup; with nothing left it only lists two folders.
 */
export const removeLegacyProviderCredentials = Effect.fn("removeLegacyProviderCredentials")(
  function* (settings: ServerSettings) {
    const { secretsDir, stateDir } = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* HostProcess.HomeDirectory;
    const listNames = (directory: string) =>
      fs.readDirectory(directory).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const remove = (target: string, recursive: boolean) =>
      fs.remove(target, { recursive }).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("could not remove a stored provider credential", {
            path: target,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

    const secrets: string[] = [];
    for (const name of yield* listNames(secretsDir)) {
      if (LEGACY_SECRET_FILE.test(name) && (yield* remove(path.join(secretsDir, name), false))) {
        secrets.push(name);
      }
    }

    // Managed Codex derived `<stateDir>/providers/codex/<instance>/shadow`; a learner may have
    // pointed an instance's own home there, and that one stays.
    const codexDir = path.join(stateDir, "providers", "codex");
    const configured = configuredCodexHomes(settings, path, home);
    const codexShadowHomes: string[] = [];
    for (const instanceId of yield* listNames(codexDir)) {
      const shadow = path.resolve(codexDir, instanceId, "shadow");
      if (configured.has(shadow)) continue;
      if (!(yield* fs.exists(shadow).pipe(Effect.orElseSucceed(() => false)))) continue;
      if (yield* remove(shadow, true)) codexShadowHomes.push(instanceId);
    }

    if (secrets.length > 0 || codexShadowHomes.length > 0) {
      yield* Effect.logInfo("removed provider credentials aprende no longer keeps", {
        secrets,
        codexShadowHomes,
      });
    }
    return { secrets, codexShadowHomes };
  },
);
