import type { OrchestrationV2ThreadShell, ScopedThreadRef } from "@aprende/contracts";

import { useRightPanelStore } from "../rightPanelStore";

/** Whether an event started in the side chat pane (`data-side-chat-pane`), which the main chat ignores. */
export function isInSideChatPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-side-chat-pane]") !== null;
}

/** Opens `thread` in its tab when it is a side chat of `parentRef`; false for any other thread. */
export function openSideChatTab(
  parentRef: ScopedThreadRef,
  thread: Pick<OrchestrationV2ThreadShell, "id" | "lineage"> | null,
): boolean {
  if (thread?.lineage.sideChat !== true || thread.lineage.parentThreadId !== parentRef.threadId) {
    return false;
  }
  useRightPanelStore.getState().openSideChat(parentRef, thread.id);
  return true;
}
