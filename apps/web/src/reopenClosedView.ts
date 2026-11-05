import type { ClosedView, ClosedViewEntry } from "./closedViewStore";
import { type ThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

export interface ReopenOwnerState {
  environmentKnown: boolean;
  catalogReady: boolean;
  ownerExists: boolean;
  /** False only for a side chat tab whose thread is gone from the shell. */
  sideChatExists: boolean;
  shellLive: boolean;
  panel: ThreadRightPanelState;
}

export function planNextReopen(
  entries: readonly ClosedViewEntry[],
  ownerState: (entry: ClosedViewEntry) => ReopenOwnerState,
): { drop: ClosedViewEntry[]; restore: ClosedViewEntry | null } {
  const drop: ClosedViewEntry[] = [];
  for (const entry of entries) {
    const owner = ownerState(entry);
    if (!owner.environmentKnown) {
      if (!owner.catalogReady) break;
      drop.push(entry);
      continue;
    }
    if (!owner.ownerExists || !owner.sideChatExists) {
      if (owner.shellLive) continue;
      break;
    }
    const alreadyOpen =
      owner.panel.isOpen && owner.panel.surfaces.some((s) => s.id === entry.surface.id);
    if (alreadyOpen) {
      drop.push(entry);
      continue;
    }
    return { drop, restore: entry };
  }
  return { drop, restore: null };
}

export function reopenClosedView(
  view: ClosedView,
  options: { workspaceAvailable: boolean },
): boolean {
  const panels = useRightPanelStore.getState();
  const ref = view.threadRef;

  const surface = view.surface;
  if (
    !options.workspaceAvailable &&
    (surface.kind === "files" || (surface.kind === "file" && !surface.attachment))
  )
    return false;
  switch (surface.kind) {
    case "file":
      if (surface.attachment) panels.openAttachment(ref, surface.attachment);
      else panels.openFile(ref, surface.relativePath, surface.revealLine ?? undefined);
      break;
    case "side-chat":
      panels.openSideChat(ref, surface.threadId);
      break;
    default:
      panels.open(ref, surface.kind);
  }
  return true;
}
