import * as NodeServices from "@effect/platform-node/NodeServices";
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

it.effect("removes stored provider credentials once and leaves Codex homes alone", () => {
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
    // A learner may still use an old managed home through CODEX_HOME or a symlink.
    const shadow = path.join(stateDir, "providers", "codex", "codex_chatgpt", "shadow");
    yield* fs.makeDirectory(shadow, { recursive: true });
    yield* fs.writeFileString(path.join(shadow, "auth.json"), "{}");

    const first = yield* removeLegacyProviderCredentials();

    assert.sameMembers(
      [...first.secrets],
      [
        "provider-auth-0a1b2c.bin",
        "provider-env-Y29kZXg-QVBJX0tFWQ.bin",
        "provider-config-Y29kZXg-Y29kZXg-a2V5.bin",
      ],
    );
    assert.deepEqual(yield* fs.readDirectory(secretsDir), ["server-signing-key.bin"]);
    assert.isTrue(yield* fs.exists(path.join(shadow, "auth.json")));
    const logged = logs.join("\n");
    assert.include(logged, "provider-auth-0a1b2c.bin");
    for (const value of Object.values(stored)) assert.notInclude(logged, value);

    logs.length = 0;
    assert.deepEqual(yield* removeLegacyProviderCredentials(), { secrets: [] });
    assert.deepEqual(logs, []);
  }).pipe(
    Effect.provide(Layer.merge(layerTest, Logger.layer([logger], { mergeWithExisting: false }))),
  );
});

it.effect("leaves a secrets folder that resolves outside aprende's state alone", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { secretsDir } = yield* ServerConfig.ServerConfig;
    const outside = yield* fs.makeTempDirectoryScoped({ prefix: "aprende-outside-secrets-" });
    const foreign = path.join(outside, "provider-auth-0a1b2c.bin");
    yield* fs.writeFileString(foreign, "not aprende's");
    yield* fs.remove(secretsDir, { recursive: true }).pipe(Effect.ignore);
    yield* fs.symlink(outside, secretsDir);

    assert.deepEqual(yield* removeLegacyProviderCredentials(), { secrets: [] });
    assert.isTrue(yield* fs.exists(foreign));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);
