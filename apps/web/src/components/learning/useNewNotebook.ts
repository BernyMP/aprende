import { scopeProjectRef } from "@aprende/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aprende/client-runtime/state/runtime";
import { type EnvironmentId, NEW_NOTEBOOK_TITLE } from "@aprende/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { waitForProject } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";
import { NEW_NOTEBOOK_MESSAGE } from "./notebook.logic";
import { useStartSession } from "./useStartSession";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : "An error occurred.";

/** Creates a notebook and opens the session where the tutor helps the learner set it up. */
export function useNewNotebook() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const startSession = useStartSession();
  const [creating, setCreating] = useState(false);

  const create = async (environmentId: EnvironmentId) => {
    const result = await createNew({ environmentId, input: { name: NEW_NOTEBOOK_TITLE } });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not create the notebook",
          description: errorMessage(squashAtomCommandFailure(result)),
        });
      }
      return;
    }
    const project = await waitForProject(
      scopeProjectRef(environmentId, result.value.projectId),
    ).catch(() => null);
    if (project === null) {
      toastManager.add({
        type: "error",
        title: "Could not open the notebook",
        description: "It was created; find it under Notebooks.",
      });
      return;
    }
    const started = await startSession(project, {
      title: "Getting started",
      text: NEW_NOTEBOOK_MESSAGE,
      failureTitle: "Could not start the notebook",
    });
    if (!started) {
      await navigate({
        to: "/notebook/$environmentId/$projectId",
        params: { environmentId, projectId: project.id },
      });
    }
  };

  return async () => {
    if (creating) return;
    // Notebooks live on this device; a remote environment would put the folder on another machine.
    const environmentId =
      environments.find(
        (environment) =>
          environment.environmentId === primaryEnvironmentId &&
          environment.serverConfig?.newProjectsRoot != null,
      )?.environmentId ?? null;
    if (environmentId === null) {
      toastManager.add({
        type: "error",
        title: "Could not create the notebook",
        description: "aprende is still connecting. Try again in a moment.",
      });
      return;
    }
    setCreating(true);
    await create(environmentId).finally(() => setCreating(false));
  };
}
