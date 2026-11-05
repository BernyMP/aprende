import { createFileRoute } from "@tanstack/react-router";

import { TutorSettingsPanel } from "../components/settings/TutorSettings";

export const Route = createFileRoute("/_chat/settings/tutor")({
  component: TutorSettingsPanel,
});
