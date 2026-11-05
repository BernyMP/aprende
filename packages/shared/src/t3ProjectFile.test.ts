import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { parseT3ProjectFile, T3ProjectFileFromJson } from "./t3ProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(T3ProjectFileFromJson);

describe("T3ProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev" });
  });
});

describe("parseT3ProjectFile", () => {
  it("reads JSONC with a URL in a block comment and drops retired worktree keys", () => {
    expect(
      parseT3ProjectFile(`{
        /* See https://aprende.invalid/schema/t3.json */
        "iconPath": "assets/logo.svg",
        "defaultThreadEnvMode": "worktree",
        "worktreeSubmodules": "none"
      }`),
    ).toEqual({ iconPath: "assets/logo.svg" });
  });
});
