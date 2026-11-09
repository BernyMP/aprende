import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@aprende/client-runtime/state/runtime";
import type { EnvironmentId, LearningNotebook, ProjectId } from "@aprende/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { toastManager } from "../ui/toast";

/** A notebook's live outline, lesson links and waiting suggestion. */
export function useNotebook(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): LearningNotebook | null {
  return useEnvironmentQuery(
    environmentId !== null && projectId !== null
      ? serverEnvironment.learningNotebookLive({ environmentId, input: { projectId } })
      : null,
  ).data;
}

/** Shows the server's reason when a notebook change fails; returns whether it succeeded. */
export function reportNotebookResult<A, E>(
  result: AtomCommandResult<A, E>,
  title: string,
): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "Something went wrong.",
    });
  }
  return false;
}
