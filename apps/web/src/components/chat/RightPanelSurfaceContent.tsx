import type {
  EditorId,
  EnvironmentId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@aprende/contracts";
import { lazy, Suspense } from "react";
import SideChatPane from "./SideChatPane";
import type { DraftId } from "../../composerDraftStore";
import { type RightPanelSurface, useRightPanelStore } from "../../rightPanelStore";

const FilePreviewPanel = lazy(() => import("../files/FilePreviewPanel"));

interface RightPanelFileProps {
  readonly projectName: string | null;
  readonly workspaceRoot: string | undefined;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly pendingSurfaceIds: ReadonlySet<string>;
  readonly onOpenFile: (relativePath: string) => void;
  readonly onPendingChange: (relativePath: string, pending: boolean) => void;
}

export function RightPanelSurfaceContent(props: {
  readonly surface: RightPanelSurface | null;
  readonly activeSurfaceId: string | null;
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly visible: boolean;
  readonly composerDraftTarget: ScopedThreadRef | DraftId;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly workspaceMutationId: string | null;
  readonly onCloseSurface: (surface: RightPanelSurface) => void;
  readonly files: RightPanelFileProps;
}) {
  const { surface, threadRef, visible, onCloseSurface } = props;
  if (surface === null) return null;
  switch (surface.kind) {
    case "side-chat":
      // Not lazy: revealing a suspended tiptap editor tears down its view and crashes the composer.
      return (
        <SideChatPane
          key={surface.id}
          parentRef={threadRef}
          threadId={surface.threadId}
          onClose={() => onCloseSurface(surface)}
        />
      );
    case "files":
    case "file": {
      const files = props.files;
      const attachment = surface.kind === "file" ? surface.attachment : undefined;
      if (!attachment && (files.projectName === null || !files.workspaceRoot)) return null;
      return (
        <Suspense fallback={null}>
          <FilePreviewPanel
            key={`${props.environmentId}:${
              attachment ? `attachment:${attachment.id}` : files.workspaceRoot
            }`}
            environmentId={props.environmentId}
            cwd={files.workspaceRoot ?? ""}
            projectName={files.projectName ?? ""}
            threadRef={threadRef}
            composerDraftTarget={props.composerDraftTarget}
            keybindings={props.keybindings}
            availableEditors={files.availableEditors}
            openInShortcutEnabled={visible}
            relativePath={surface.kind === "file" ? surface.relativePath : null}
            {...(attachment ? { attachment } : {})}
            revealLine={surface.kind === "file" ? (surface.revealLine ?? null) : null}
            revealRequestId={surface.kind === "file" ? surface.revealRequestId : 0}
            onOpenFile={files.onOpenFile}
            onNavigateFolder={(relativePath, folderTrail, keepSource) =>
              useRightPanelStore
                .getState()
                .navigateFolder(threadRef, surface.id, relativePath, folderTrail, keepSource)
            }
            folderTrail={surface.folderTrail}
            onPendingChange={files.onPendingChange}
            selectedFilePending={surface.kind === "file" && files.pendingSurfaceIds.has(surface.id)}
            workspaceMutationId={props.workspaceMutationId}
          />
        </Suspense>
      );
    }
  }
}
