import type { EnvironmentId, LearningNotebook, ProjectId } from "@aprende/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

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
