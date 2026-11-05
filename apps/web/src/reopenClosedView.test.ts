import { DEFAULT_CLIENT_SETTINGS, type ScopedThreadRef } from "@aprende/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";
import { __setClientSettingsForTests } from "./hooks/useSettings";
import { planNextReopen, type ReopenOwnerState, reopenClosedView } from "./reopenClosedView";
import {
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};
beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("reopenClosedView", () => {
  it("restores a file tab at its line", () => {
    const reopened = reopenClosedView(
      {
        kind: "panel-tab",
        threadRef,
        surface: {
          kind: "file",
          id: "file:src/app.ts",
          relativePath: "src/app.ts",
          revealLine: 18,
          revealRequestId: 1,
        },
      },
      { workspaceAvailable: true },
    );
    expect(reopened).toBe(true);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
    expect(state.isOpen).toBe(true);
    expect(state.surfaces).toMatchObject([{ id: "file:src/app.ts", revealLine: 18 }]);
  });

  it("does not reopen workspace tabs without an available project", () => {
    const options = { workspaceAvailable: false };
    for (const surface of [
      { kind: "files", id: "files" },
      {
        kind: "file",
        id: "file:src/app.ts",
        relativePath: "src/app.ts",
        revealLine: null,
        revealRequestId: 0,
      },
    ] as const) {
      expect(reopenClosedView({ kind: "panel-tab", threadRef, surface }, options)).toBe(false);
    }
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
    ).toEqual([]);
  });
});

describe("planNextReopen", () => {
  const entries: ClosedViewEntry[] = [
    {
      id: "a",
      kind: "panel-tab",
      threadRef,
      surface: {
        kind: "file",
        id: "file:a.ts",
        relativePath: "a.ts",
        revealLine: null,
        revealRequestId: 0,
      },
    },
    { id: "b", kind: "panel-tab", threadRef, surface: { kind: "files", id: "files" } },
  ];
  const known: ReopenOwnerState = {
    environmentKnown: true,
    catalogReady: true,
    ownerExists: true,
    sideChatExists: true,
    shellLive: true,
    panel: { isOpen: false, activeSurfaceId: null, surfaces: [] },
  };
  const openFilePanel: ThreadRightPanelState = {
    isOpen: true,
    activeSurfaceId: "file:a.ts",
    surfaces: [
      { kind: "file", id: "file:a.ts", relativePath: "a.ts", revealLine: null, revealRequestId: 0 },
    ],
  };

  it.each([
    ["restores the newest entry", [known, known], [], "a"],
    [
      "drops a removed environment once the catalog is ready",
      [{ ...known, environmentKnown: false }, known],
      ["a"],
      "b",
    ],
    [
      "waits for the catalog before dropping",
      [{ ...known, environmentKnown: false, catalogReady: false }, known],
      [],
      null,
    ],
    [
      "skips but keeps a thread deleted from a live shell",
      [{ ...known, ownerExists: false }, known],
      [],
      "b",
    ],
    [
      "skips but keeps a side chat deleted from a live shell",
      [{ ...known, sideChatExists: false }, known],
      [],
      "b",
    ],
    [
      "waits when a cached shell lacks the side chat",
      [{ ...known, sideChatExists: false, shellLive: false }, known],
      [],
      null,
    ],
    [
      "waits when a cached shell lacks the thread",
      [{ ...known, ownerExists: false, shellLive: false }, known],
      [],
      null,
    ],
    ["drops a tab that is already open", [{ ...known, panel: openFilePanel }, known], ["a"], "b"],
    [
      "restores a tab whose panel is hidden",
      [{ ...known, panel: { ...openFilePanel, isOpen: false } }],
      [],
      "a",
    ],
  ] as const)("%s", (_name, owners, dropped, restored) => {
    const plan = planNextReopen(
      entries.slice(0, owners.length),
      (e) => owners[entries.indexOf(e)]!,
    );
    expect(plan.drop.map((e) => e.id)).toEqual(dropped);
    expect(plan.restore?.id ?? null).toBe(restored);
  });
});
