// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "APRENDE_DEV_AUTH_TOKEN=root\nAPRENDE_HOME=/root-home\n",
    );
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "APRENDE_DEV_AUTH_TOKEN=local\n");

    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toMatchObject({
      APRENDE_DEV_AUTH_TOKEN: "local",
      APRENDE_HOME: "/root-home",
    });
    expect(loadRepoEnv({ baseEnv: { APRENDE_DEV_AUTH_TOKEN: "process" }, repoRoot })).toMatchObject(
      { APRENDE_DEV_AUTH_TOKEN: "process", APRENDE_HOME: "/root-home" },
    );
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aprende-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
