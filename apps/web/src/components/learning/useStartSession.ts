import { scopeThreadRef } from "@aprende/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aprende/client-runtime/state/runtime";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  learningSessionStartMessage,
  type ThreadId,
} from "@aprende/contracts";
import { resolveProjectSettings } from "@aprende/shared/projectSettings";
import { truncate } from "@aprende/shared/String";
import { resolveNewThreadModelSelection } from "@aprende/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";

import { newMessageId, newThreadId } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { waitForStartedServerThread } from "../ChatView.logic";
import { toastManager } from "../ui/toast";

export interface SessionStart {
  readonly title: string;
  /** What the learner asks for by starting the session; the tutor reads it, the learner never sees it. */
  readonly text: string;
  readonly failureTitle: string;
  /** Runs before the session exists; returning false stops the start. */
  readonly beforeStart?: (threadId: ThreadId) => Promise<boolean>;
}

/** Starts a session in the project with its default model and opens it. */
export function useStartSession() {
  const navigate = useNavigate();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  return async (project: EnvironmentProject, start: SessionStart): Promise<boolean> => {
    const failed = (description: string) =>
      toastManager.add({ type: "error", title: start.failureTitle, description });
    const { environmentId } = project;
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      failed("This connection cannot start sessions.");
      return false;
    }
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    const serverSettings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
    const providers = config?.providers ?? [];
    const projectSettings = resolveProjectSettings(serverSettings, project.id, project).settings;
    const { selection } = resolveNewThreadModelSelection({
      defaultSelection:
        projectSettings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(providers, serverSettings, project.id),
      fallbackSelection: serverSettings.fallbackModelSelection ?? null,
      providers,
      settings: serverSettings,
      projectId: project.id,
      now: Date.now(),
    });
    if (selection === null) {
      failed("Set up Claude or Codex in Settings first.");
      return false;
    }

    const threadId = newThreadId();
    if (start.beforeStart !== undefined && !(await start.beforeStart(threadId))) return false;
    const createdAt = new Date().toISOString();
    const title = truncate(start.title);
    const runtimeMode = projectSettings.defaultRuntimeMode;
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: learningSessionStartMessage(start.text),
          attachments: [],
        },
        modelSelection: selection,
        titleSeed: title,
        runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection: selection,
            runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        failed(error instanceof Error ? error.message : "The session did not start.");
      }
      return false;
    }
    await waitForStartedServerThread(scopeThreadRef(environmentId, threadId));
    await navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
    return true;
  };
}
