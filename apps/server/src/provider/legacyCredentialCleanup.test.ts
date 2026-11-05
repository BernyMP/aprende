import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@aprende/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { removeLegacyProviderCredentials } from "./legacyCredentialCleanup.ts";

const layerTest = ServerConfig.layerTest(process.cwd(), {
  prefix: "aprende-legacy-credentials-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.effect("removes stored provider credentials and managed Codex homes once", () => {
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => logs.push(JSON.stringify(message)));
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { secretsDir, stateDir } = yield* ServerConfig.ServerConfig;
    yield* fs.makeDirectory(secretsDir, { recursive: true });
    const stored = {
      "provider-auth-0a1b2c.bin": "chatgpt-refresh-token-value",
      "provider-env-Y29kZXg-QVBJX0tFWQ.bin": "env-secret-value",
      "provider-config-Y29kZXg-Y29kZXg-a2V5.bin": "config-secret-value",
      "server-signing-key.bin": "own-signing-key",
    };
    for (const [name, value] of Object.entries(stored)) {
      yield* fs.writeFileString(path.join(secretsDir, name), value);
    }
    const codexDir = path.join(stateDir, "providers", "codex");
    const managedShadow = path.join(codexDir, "codex_chatgpt", "shadow");
    const learnerShadow = path.join(codexDir, "codex_mine", "shadow");
    for (const shadow of [managedShadow, learnerShadow]) {
      yield* fs.makeDirectory(shadow, { recursive: true });
      yield* fs.writeFileString(path.join(shadow, "auth.json"), "{}");
    }
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_mine")]: {
          driver: ProviderDriverKind.make("codex"),
          config: { shadowHomePath: learnerShadow },
        },
      },
    };

    const first = yield* removeLegacyProviderCredentials(settings);

    assert.sameMembers(
      [...first.secrets],
      [
        "provider-auth-0a1b2c.bin",
        "provider-env-Y29kZXg-QVBJX0tFWQ.bin",
        "provider-config-Y29kZXg-Y29kZXg-a2V5.bin",
      ],
    );
    assert.deepEqual(first.codexShadowHomes, ["codex_chatgpt"]);
    assert.deepEqual(yield* fs.readDirectory(secretsDir), ["server-signing-key.bin"]);
    assert.isFalse(yield* fs.exists(managedShadow));
    assert.isTrue(yield* fs.exists(path.join(learnerShadow, "auth.json")));
    const logged = logs.join("\n");
    assert.include(logged, "provider-auth-0a1b2c.bin");
    for (const value of Object.values(stored)) assert.notInclude(logged, value);

    logs.length = 0;
    const second = yield* removeLegacyProviderCredentials(settings);
    assert.deepEqual(second, { secrets: [], codexShadowHomes: [] });
    assert.deepEqual(logs, []);
  }).pipe(
    Effect.provide(Layer.merge(layerTest, Logger.layer([logger], { mergeWithExisting: false }))),
  );
});
