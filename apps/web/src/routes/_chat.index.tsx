import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import { createFileRoute } from "@tanstack/react-router";

import { HostedEmptyState } from "../components/HostedEmptyState";
import { NotebooksHome } from "../components/learning/NotebooksHome";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
  useVisibleThreadShells,
} from "../state/entities";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexLanding />;
}

/** aprende opens on the learner's notebooks; with none yet, on how to start. */
function IndexLanding() {
  const projects = useProjects();
  const visibleThreads = useVisibleThreadShells();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();

  const notebooks = sortScopedProjectsForSidebar(
    projects.filter((project) => project.archivedAt == null && project.isScratch !== true),
    visibleThreads,
    "updated_at",
  );
  if (notebooks.length === 0) {
    // A pending environment cannot prove the learner has no notebooks.
    return bootstrapped ? <NoProjectsHero /> : null;
  }
  // Each card scans only its own notebook's threads.
  const threadsByNotebook = new Map<string, Array<EnvironmentThreadShell>>();
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const group = threadsByNotebook.get(key);
    if (group === undefined) threadsByNotebook.set(key, [thread]);
    else group.push(thread);
  }
  return <NotebooksHome notebooks={notebooks} threadsByNotebook={threadsByNotebook} />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
