import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed pages, such as a remembered old location, open the Tutor page instead of a blank screen.
export const Route = createFileRoute("/_chat/settings/$")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/tutor", replace: true });
  },
});
