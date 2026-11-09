import type { EnvironmentId, ProjectId } from "@aprende/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { NotebookPage } from "../components/learning/NotebookPage";

export const Route = createFileRoute("/_chat/notebook/$environmentId/$projectId")({
  component: NotebookRoute,
});

function NotebookRoute() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <NotebookPage
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}
