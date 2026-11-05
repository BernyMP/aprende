import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";
import type { EnvironmentId, ServerConfig } from "@aprende/contracts";
import { newProjectFolderName } from "@aprende/shared/path";

import { ensureBrowseDirectoryPath, findProjectByPath } from "../state/projects.ts";
import type { EnvironmentProject } from "../state/models.ts";

export function canCreateProjectInEnvironment(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
): boolean {
  return connectionPhase === "connected";
}

export function availableScratchWorkspaceRoot(
  connectionPhase: EnvironmentConnectionPhase | null | undefined,
  serverConfig: Pick<ServerConfig, "scratchWorkspaceRoot"> | null | undefined,
): string | null {
  return canCreateProjectInEnvironment(connectionPhase)
    ? (serverConfig?.scratchWorkspaceRoot ?? null)
    : null;
}

export function getNewProjectPathPreview(newProjectsRoot: string, name: string): string {
  const folder = newProjectFolderName(name);
  if (folder.length === 0) return newProjectsRoot;
  const base = ensureBrowseDirectoryPath(newProjectsRoot);
  return `${base}${base.endsWith("\\") ? folder.replaceAll("/", "\\") : folder}`;
}

export function findExistingAddProject(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environmentId: EnvironmentId;
  readonly path: string;
}): EnvironmentProject | null {
  return (
    findProjectByPath(
      input.projects.filter((project) => project.environmentId === input.environmentId),
      input.path,
    ) ?? null
  );
}
