import { scopeThreadRef } from "@aprende/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aprende/client-runtime/state/runtime";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  type LearningProposition,
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
import { buildPracticeMessage, type PracticeKind } from "./knowledge.logic";

const failed = (description: string) =>
  toastManager.add({ type: "error", title: "Could not start practice", description });

/** Starts a session in the project with its default model and asks the tutor to practice or review. */
export function usePracticeSession() {
  const navigate = useNavigate();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  return async (
    project: EnvironmentProject,
    propositions: ReadonlyArray<LearningProposition>,
    kind: PracticeKind = "practice",
  ): Promise<boolean> => {
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
    const createdAt = new Date().toISOString();
    const label = kind === "review" ? "Review" : "Practice";
    const title = truncate(
      propositions.length === 1
        ? `${label}: ${propositions[0]!.name}`
        : `${label}: ${propositions.length} propositions`,
    );
    const runtimeMode = projectSettings.defaultRuntimeMode;
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: buildPracticeMessage(propositions, kind),
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
