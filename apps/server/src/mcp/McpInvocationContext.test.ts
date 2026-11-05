import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  McpCapabilityUnavailableError,
  ProviderInstanceId,
  ThreadId,
} from "@aprende/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "./McpInvocationContext.ts";

it.effect("reports other missing capabilities with the neutral error", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    requestNamespace: "provider-session-1",
    thread: {
      threadId: ThreadId.make("thread-1"),
      providerSessionId: "provider-session-1",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    capabilities: new Set(["orchestration"]),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireMcpCapability("worktree").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(McpCapabilityUnavailableError);
    expect(error).toMatchObject({
      capability: "worktree",
      threadId: invocation.thread?.threadId,
    });

    const scope = yield* McpInvocationContext.requireMcpCapability("orchestration").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
    );
    expect(scope).toBe(invocation);
  });
});

it("acts at an administrator's ceiling for a client approved above it", () => {
  const scope = (
    access: McpInvocationContext.McpClientCaller["access"],
    narrowedTo?: McpInvocationContext.ClientModes,
  ): McpInvocationContext.McpInvocationScope => ({
    environmentId: EnvironmentId.make("environment-1"),
    requestNamespace: "client:session-1",
    thread: undefined,
    client: { sessionId: "session-1", label: "Claude Code", access, narrowedTo },
    capabilities: new Set(["orchestration"]),
    issuedAt: 1,
  });
  const modes = (invocation: McpInvocationContext.McpInvocationScope, ceiling?: "auto") =>
    McpInvocationContext.clientModeCeiling(
      McpInvocationContext.withRuntimeModeCeiling(invocation, ceiling).client,
    );

  expect(modes(scope("full-access"), "auto")).toEqual({
    runtimeMode: "auto",
    interactionMode: "default",
  });
  // A narrower request and the approved mode still win below the ceiling.
  expect(
    modes(
      scope("full-access", { runtimeMode: "approval-required", interactionMode: "plan" }),
      "auto",
    ),
  ).toEqual({ runtimeMode: "approval-required", interactionMode: "plan" });
  expect(modes(scope("auto-accept-edits"), "auto").runtimeMode).toBe("auto-accept-edits");
  expect(modes(scope("full-access")).runtimeMode).toBe("full-access");
});
