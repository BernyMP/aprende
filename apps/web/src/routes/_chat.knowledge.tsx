import { createFileRoute } from "@tanstack/react-router";

import { KnowledgePage } from "../components/learning/KnowledgePage";

export const Route = createFileRoute("/_chat/knowledge")({
  validateSearch: (raw: Record<string, unknown>): { view?: "due" } =>
    raw.view === "due" ? { view: "due" } : {},
  component: KnowledgeRoute,
});

function KnowledgeRoute() {
  const { view } = Route.useSearch();
  return <KnowledgePage dueOnly={view === "due"} />;
}
