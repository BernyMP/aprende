import type { ContextMenuItem, EnvironmentId } from "@aprende/contracts";

import { resolveDiffPathForWorkspace } from "./diffFileActions";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "~/components/files/fileExplorerLabel";
import { readLocalApi } from "./localApi";
import { serverEnvironment } from "./state/server";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { resolvePathLinkTarget } from "@aprende/shared/fileLinks";
import { toastManager } from "./components/ui/toast";
import { useAtomValue } from "@effect/atom-react";

export type FileContextMenuAction = "reveal-in-folder" | "open";

export interface FileContextMenuTarget {
  readonly environmentId: EnvironmentId | null;
  /** Repo- or workspace-relative file path, as shown in diffs. */
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot?: string | undefined;
}

export function resolveFileContextMenuAbsolutePath(target: FileContextMenuTarget): string | null {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath: target.filePath,
    workspaceRoot: target.workspaceRoot,
    repositoryRoot: target.repositoryRoot,
  });
  if (workspaceFilePath === null) return null;
  if (target.workspaceRoot === undefined) {
    return workspaceFilePath.startsWith("/") || /^[a-zA-Z]:/.test(workspaceFilePath)
      ? workspaceFilePath
      : null;
  }
  return resolvePathLinkTarget(workspaceFilePath, target.workspaceRoot);
}

export interface FileContextMenuCapabilities {
  readonly revealLabel: string | undefined;
  readonly canOpenDefault: boolean;
}

function buildFileContextMenuItems(input: {
  readonly hasAbsolutePath: boolean;
  readonly capabilities: FileContextMenuCapabilities;
}): readonly ContextMenuItem<FileContextMenuAction>[] {
  if (!input.hasAbsolutePath) return [];
  const items: ContextMenuItem<FileContextMenuAction>[] = [];
  if (input.capabilities.canOpenDefault) {
    items.push({ id: "open", label: "Open", icon: "pencil" });
  }
  if (input.capabilities.revealLabel !== undefined) {
    items.push({
      id: "reveal-in-folder",
      label: input.capabilities.revealLabel,
      icon: "folder-tree",
    });
  }
  return items;
}

export function useFileContextMenu(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));

  const canUseFileManager = serverConfig?.availableEditors.includes("file-manager") === true;
  const capabilities: FileContextMenuCapabilities = {
    // WSL can reveal in Windows Explorer despite reporting Linux; use server wording.
    revealLabel:
      environmentId !== null && serverConfig?.shellRevealInFileManager === true && canUseFileManager
        ? serverConfig.shellRevealInFileManagerKind === undefined
          ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os)
          : revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind)
        : undefined,
    canOpenDefault: canUseFileManager,
  };

  const activate = async (
    action: FileContextMenuAction,
    target: FileContextMenuTarget,
  ): Promise<void> => {
    const absolutePath = resolveFileContextMenuAbsolutePath(target);
    if (absolutePath === null || environmentId === null) return;

    const reveal = action === "reveal-in-folder";
    const result = await openInEditor({
      environmentId,
      input: { cwd: absolutePath, editor: "file-manager", ...(reveal ? { reveal: true } : {}) },
    });
    if (result._tag !== "Failure") return;
    toastManager.add({
      type: "error",
      title: reveal ? "Unable to reveal file" : "Could not open file",
      description: absolutePath,
    });
  };

  const show = async (
    target: FileContextMenuTarget,
    position?: { x: number; y: number },
  ): Promise<void> => {
    const api = readLocalApi();
    const items = buildFileContextMenuItems({
      hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
      capabilities,
    });
    if (items.length === 0 || api === undefined) return;
    const clicked = await api.contextMenu.show(items, position);
    if (clicked === null) return;
    await activate(clicked as FileContextMenuAction, target);
  };

  return {
    buildItems: (target: FileContextMenuTarget) =>
      buildFileContextMenuItems({
        hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
        capabilities,
      }),
    capabilities,
    activate,
    show,
  };
}
