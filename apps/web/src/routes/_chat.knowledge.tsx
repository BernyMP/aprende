import { createFileRoute } from "@tanstack/react-router";

import { KnowledgePage } from "../components/learning/KnowledgePage";

export const Route = createFileRoute("/_chat/knowledge")({
  component: KnowledgePage,
});
