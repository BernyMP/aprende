import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

// Earlier builds kept ChatGPT tokens and client registrations (provider-auth), sensitive
// provider variables (provider-env) and masked config fields (provider-config) here.
const LEGACY_SECRET_FILE = /^provider-(?:auth|env|config)-[\w-]+\.bin$/;

/**
 * Learners sign in through their own CLI, so aprende deletes the provider credentials earlier
 * builds stored in its own secrets folder. Old managed Codex homes are left alone: they held no
 * credentials, and deleting folders could reach a home the learner still uses.
 */
export const removeLegacyProviderCredentials = Effect.fn("removeLegacyProviderCredentials")(
  function* () {
    const { secretsDir } = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs
      .readDirectory(secretsDir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const secrets: string[] = [];
    for (const name of names) {
      if (!LEGACY_SECRET_FILE.test(name)) continue;
      const removed = yield* fs.remove(path.join(secretsDir, name)).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("could not remove a stored provider credential", { name, cause }).pipe(
            Effect.as(false),
          ),
        ),
      );
      if (removed) secrets.push(name);
    }
    if (secrets.length > 0) {
      yield* Effect.logInfo("removed provider credentials aprende no longer keeps", { secrets });
    }
    return { secrets };
  },
);
