import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, TUTOR_MCP_TOOL_NAMES } from "@aprende/contracts";
import { McpProviderSessions } from "@aprende/provider-core/server/McpProviderSessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/ai";

import { AssetSigner } from "../assets/AssetSigner.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { LearningService } from "../learning/LearningService.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import {
  CLAUDE_PROVIDER,
  CLAUDE_TUTOR_HIDDEN_MCP_TOOLS,
  makeClaudeQueryOptions,
} from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProviderAdapterRegistryV2 } from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ThreadSearch } from "../orchestration-v2/ThreadSearch.ts";
import { PreviewBrowser } from "../htmlRender/PreviewBrowser.ts";
import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { SecretRequests } from "../secrets/SecretRequests.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { DocumentText } from "./DocumentText.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import budget from "./agentContextBudget.json" with { type: "json" };

// Registration only stores tool definitions, so the handlers' services are never called.
const toolHandlerServices = Layer.mergeAll(
  Layer.mock(AssetSigner)({}),
  Layer.mock(DocumentText)({}),
  Layer.mock(GitVcsDriver)({}),
  Layer.mock(GitWorkflowService)({}),
  Layer.mock(LearningService)({}),
  Layer.mock(ManagedProjectFolders)({ namedProjectsRoot: "" }),
  Layer.mock(McpProviderSessions)({}),
  Layer.mock(OrchestratorV2)({}),
  Layer.mock(PreviewBrowser)({}),
  Layer.mock(ProjectService)({}),
  Layer.mock(ProviderAdapterRegistryV2)({}),
  Layer.mock(ProviderRegistry)({}),
  Layer.mock(SecretRequests)({}),
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-agent-context-budget-" }),
  Layer.mock(ServerEnvironment)({}),
  Layer.mock(ServerSecretStore)({}),
  Layer.mock(ServerSettingsService)({}),
  Layer.mock(ThreadLaunchService)({}),
  Layer.mock(ThreadManagementService)({}),
  Layer.mock(ThreadSearch)({}),
  Layer.mock(VcsStatusBroadcaster)({}),
).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

const claudeSystemPrompt = () => {
  const { systemPrompt } = makeClaudeQueryOptions({
    modelSelection: {
      instanceId: ProviderInstanceId.make(CLAUDE_PROVIDER),
      model: "claude-opus-5-5",
    },
    nativeThreadId: "context-budget",
    resume: false,
    cwd: null,
    mcpServers: { aprende: { type: "http", url: "http://127.0.0.1/mcp" } },
  });
  return typeof systemPrompt === "string" ? systemPrompt : "";
};

const layerAdvertisedTools = McpHttpServer.layerTools.pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(toolHandlerServices),
);

// Claude Code loads these tools up front instead of behind ToolSearch, outside this budget.
it.effect("only request_secret asks Claude Code to load it up front", () =>
  Effect.gen(function* () {
    const mcp = yield* McpServer.McpServer;
    const alwaysLoad = mcp.tools
      .filter(({ tool }) => tool._meta?.["anthropic/alwaysLoad"] !== undefined)
      .map(({ tool }) => [tool.name, tool._meta]);
    expect(alwaysLoad).toEqual([["request_secret", { "anthropic/alwaysLoad": true }]]);
  }).pipe(Effect.provide(layerAdvertisedTools)),
);

it.effect("hides every tool but the tutor's from Claude tutor sessions", () =>
  Effect.gen(function* () {
    const mcp = yield* McpServer.McpServer;
    const hidden = mcp.tools
      .map(({ tool }) => tool.name)
      .filter((name) => !TUTOR_MCP_TOOL_NAMES.includes(name))
      .map((name) => `mcp__aprende__${name}`)
      .toSorted();
    expect([...CLAUDE_TUTOR_HIDDEN_MCP_TOOLS].toSorted()).toEqual(hidden);
  }).pipe(Effect.provide(layerAdvertisedTools)),
);

// CI rejects a PR that raises any value above main's agentContextBudget.json, so growth
// needs the agent-context-increase label. Lower the values when the text shrinks.
it.effect("agent context matches the committed budget", () =>
  Effect.gen(function* () {
    const mcp = yield* McpServer.McpServer;
    const measured = {
      // Codex receives the same tutor prompt as developer instructions.
      tutorPromptBytes: utf8Bytes(claudeSystemPrompt()),
      // The model sees these fields. outputSchema and annotations are protocol metadata.
      mcpToolListJsonBytes: utf8Bytes(
        JSON.stringify(
          mcp.tools
            .filter(({ tool }) => TUTOR_MCP_TOOL_NAMES.includes(tool.name))
            .map(({ tool }) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
        ),
      ),
    };

    expect(
      measured,
      "Set agentContextBudget.json to the measured values. Before you cut text to fit, run the evals that cover it (evals/README.md).",
    ).toEqual(budget);
  }).pipe(Effect.provide(layerAdvertisedTools)),
);
