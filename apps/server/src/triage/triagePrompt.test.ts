import { assert, it } from "@effect/vitest";

import {
  buildTriageContext,
  buildTriageLaunchPrompt,
  type TriageContextInput,
} from "./triagePrompt.ts";

it("launch prompt stays a single argv-safe line naming the prompt file", () => {
  // Windows .cmd shims cannot carry multiline argv.
  const launch = buildTriageLaunchPrompt(String.raw`C:\Users\a b\.t3\userdata\triage\x\prompt.md`);
  assert.notInclude(launch, "\n");
  assert.include(launch, String.raw`C:\Users\a b\.t3\userdata\triage\x\prompt.md`);
  assert.isBelow(launch.length, 1_000);
});

it("context file labels the CLI version as the CLI's, not the user's build", () => {
  const context = buildTriageContext({
    ...contextInput,
    entry: { kind: "cli", cliVersion: "0.0.42", launchedAs: "npx aprende triage" },
    server: "running (pid 42, http://127.0.0.1:3773, version 0.0.43-nightly.20260923.2173)",
  });
  assert.notInclude(context, "Installed version");
  assert.notInclude(context, "Release tag");
  assert.include(context, "- Triage CLI version: 0.0.42 (");
  assert.include(context, "version 0.0.43-nightly.20260923.2173");
  assert.notInclude(context, "runs inside aprende");
});

it("in-app context warns the agent off its own server and points at the clone in progress", () => {
  const context = buildTriageContext({
    ...contextInput,
    entry: { kind: "app", client: "aprende Desktop version 0.1.1 on macos" },
    server: "running (pid 42, version 0.1.1); this session runs inside it",
    sourceClone: {
      _tag: "cloning",
      directory: "/home/u/.aprende/source/abc123",
      ref: "v0.1.1",
      commit: "abc123",
      serverVersion: "0.1.1",
    },
  });
  assert.notInclude(context, "Triage CLI version");
  assert.include(context, "- Started from: aprende Desktop version 0.1.1 on macos (");
  assert.include(context, "## This session runs inside aprende");
  assert.include(context, "/home/u/.aprende/source/abc123  (v0.1.1, commit abc123)");
  assert.include(context, "Wait for it instead of\ncloning again.");
});

const contextInput = {
  generatedAt: "2026-09-24T00:00:00.000Z",
  os: "linux x64 (7.2.0)",
  nodeVersion: "v26.8.2",
  paths: {
    stateDir: "/home/u/.aprende/userdata",
    dbPath: "/home/u/.aprende/userdata/state.sqlite",
    settingsPath: "/home/u/.aprende/userdata/settings.json",
    logsDir: "/home/u/.aprende/userdata/logs",
    serviceLogPath: "/home/u/.aprende/userdata/logs/boot-service.log",
    desktopBackendLogGlob: "/home/u/.aprende/userdata/logs/server-child*.log*",
    relayClientLogPath: "/home/u/.aprende/userdata/logs/relay-client.ndjson",
    serverTracePath: "/home/u/.aprende/userdata/logs/server.trace.ndjson",
    providerEventLogPath: "/home/u/.aprende/userdata/logs/provider/events.log",
    terminalLogsDir: "/home/u/.aprende/userdata/logs/terminals",
    providerStatusCacheDir: "/home/u/.aprende/caches",
    secretsDir: "/home/u/.aprende/userdata/secrets",
    sourceCacheDir: "/home/u/.aprende/source",
  },
} satisfies Omit<TriageContextInput, "entry" | "server">;
