import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  type ScopedThreadRef,
} from "@aprende/contracts";
import { scopeThreadRef } from "@aprende/client-runtime/environment";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { environmentShell } from "../state/shell";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useStableCallback } from "./useStableCallback";

/** Closing deletes a side chat that never ran, and ends a practice terminal's shell. */
export function useRightPanelSurfaceClose(input: { readonly threadRef: ScopedThreadRef | null }) {
  const { threadRef } = input;
  const deleteThread = useAtomCommand(threadEnvironment.delete, "side chat delete");
  const closePracticeTerminal = useAtomCommand(
    serverEnvironment.closePracticeTerminal,
    "close the terminal",
  );
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );

  const releaseSurfaceResources = (ref: ScopedThreadRef, surface: RightPanelSurface) => {
    if (
      surface.kind === "practice-terminal" &&
      readEnvironmentScope(ref.environmentId, AuthTerminalOperateScope)
    ) {
      void closePracticeTerminal({
        environmentId: ref.environmentId,
        input: { threadId: surface.threadId, problemId: surface.problemId },
      });
      return;
    }
    if (
      surface.kind === "side-chat" &&
      readEnvironmentScope(ref.environmentId, AuthOrchestrationOperateScope) &&
      // A live shell without the side chat means it is already deleted.
      !(
        appAtomRegistry.get(environmentShell.stateValueAtom(ref.environmentId)).status === "live" &&
        readThreadShell(scopeThreadRef(ref.environmentId, surface.threadId)) === null
      )
    ) {
      // The server keeps a side chat with a run or message. Reopen skips one it deleted.
      void deleteThread({
        environmentId: ref.environmentId,
        input: { threadId: surface.threadId, onlyIfUnused: true },
      });
    }
  };
  // The active surface closes last so the panel does not flash through it.
  const closeSurfaces = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    const store = useRightPanelStore.getState();
    const activeId = selectThreadRightPanelState(store.byThreadKey, threadRef).activeSurfaceId;
    const ordered = toClose.toSorted(
      (left, right) => Number(left.id === activeId) - Number(right.id === activeId),
    );
    for (const surface of ordered) {
      store.closeSurface(threadRef, surface.id);
      releaseSurfaceResources(threadRef, surface);
    }
  };

  const closeSurface = useStableCallback((surface: RightPanelSurface) => closeSurfaces([surface]));
  const closeOtherSurfaces = useStableCallback((surface: RightPanelSurface) =>
    closeSurfaces(surfaces.filter((entry) => entry.id !== surface.id)),
  );
  const closeSurfacesToRight = useStableCallback((surface: RightPanelSurface) => {
    const surfaceIndex = surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;
    closeSurfaces(surfaces.slice(surfaceIndex + 1));
  });
  const closeAllSurfaces = useStableCallback(() => closeSurfaces(surfaces));

  return { closeSurface, closeOtherSurfaces, closeSurfacesToRight, closeAllSurfaces };
}
