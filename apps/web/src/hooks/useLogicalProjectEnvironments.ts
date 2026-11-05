import { availableScratchWorkspaceRoot } from "@aprende/client-runtime/operations/projects";
import { isScratchProject } from "@aprende/client-runtime/state/projects";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import {
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ProjectId,
  resolveEnvironmentMachineKind,
} from "@aprende/contracts";

import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@aprende/client-runtime/state/project-grouping";
import { useProjects } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useClientSettings } from "./useSettings";

export interface EnvironmentOption {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  label: string;
  isPrimary: boolean;
  machine: EnvironmentMachineKind;
}

export function useLogicalProjectEnvironments(
  activeProject: EnvironmentProject | null,
  scratchDraft: boolean,
): readonly EnvironmentOption[] {
  const { environments } = useEnvironments();
  const allProjects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);

  if (!activeProject) return [];
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const envs: EnvironmentOption[] = [];
  const pushEnvironment = (environmentId: EnvironmentId, projectId: ProjectId | null) => {
    const environment = environmentById.get(environmentId) ?? null;
    envs.push({
      environmentId,
      projectId,
      label: environment?.label ?? environmentId,
      isPrimary: environmentId === primaryEnvironmentId,
      machine: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
    });
  };
  if (scratchDraft) {
    for (const environment of environments) {
      const scratchRoot = availableScratchWorkspaceRoot(
        environment.connection.phase,
        environment.serverConfig,
      );
      if (scratchRoot === null && environment.environmentId !== activeProject.environmentId)
        continue;
      const scratchProject =
        environment.environmentId === activeProject.environmentId
          ? activeProject
          : allProjects.find(
              (p) =>
                p.environmentId === environment.environmentId && isScratchProject(p, scratchRoot),
            );
      pushEnvironment(environment.environmentId, scratchProject?.id ?? null);
    }
  } else {
    const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings);
    const seen = new Set<string>();
    for (const p of allProjects) {
      if (seen.has(p.environmentId)) continue;
      if (deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) !== logicalKey) continue;
      seen.add(p.environmentId);
      pushEnvironment(p.environmentId, p.id);
    }
  }
  envs.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return envs;
}

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

/** A primary environment's generic runtime label reads as "This device". */
export function resolveEnvironmentOptionLabel(input: {
  isPrimary: boolean;
  environmentId: EnvironmentId;
  runtimeLabel?: string | null;
}): string {
  const runtimeLabel = input.runtimeLabel?.trim() || null;
  if (input.isPrimary) {
    return runtimeLabel && !GENERIC_LOCAL_ENVIRONMENT_LABELS.has(runtimeLabel.toLowerCase())
      ? runtimeLabel
      : "This device";
  }
  return runtimeLabel ?? input.environmentId;
}
