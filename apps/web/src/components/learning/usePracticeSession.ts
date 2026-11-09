import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import type { LearningProposition } from "@aprende/contracts";

import { buildPracticeMessage, type PracticeKind } from "./knowledge.logic";
import { useStartSession } from "./useStartSession";

/** Starts a session in the project and asks the tutor to practice or review. */
export function usePracticeSession() {
  const startSession = useStartSession();

  return (
    project: EnvironmentProject,
    propositions: ReadonlyArray<LearningProposition>,
    kind: PracticeKind = "practice",
  ): Promise<boolean> => {
    const label = kind === "review" ? "Review" : "Practice";
    return startSession(project, {
      title:
        propositions.length === 1
          ? `${label}: ${propositions[0]!.name}`
          : `${label}: ${propositions.length} propositions`,
      text: buildPracticeMessage(propositions, kind),
      failureTitle: "Could not start practice",
    });
  };
}
