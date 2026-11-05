import { scopeThreadRef } from "@aprende/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@aprende/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-2" as EnvironmentId, ThreadId.make("thread-A"));
const files = (threadRef: typeof refA) =>
  ({ kind: "panel-tab", threadRef, surface: { kind: "files", id: "files" } }) as const;

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
});

describe("closedViewStore", () => {
  it.each([
    {
      id: "bad",
      kind: "browser",
      threadRef: refA,
      snapshot: { tabId: "tab", navStatus: { _tag: "Idle" } },
    },
    { id: "bad", kind: "panel-tab", surface: { kind: "files", id: "files" } },
    { id: "bad", kind: "panel-tab", threadRef: refA },
    { id: "bad", kind: "panel-tab", threadRef: {}, surface: { kind: "files", id: "files" } },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: {} },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: { kind: "diff", id: "diff" } },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: { kind: "file", id: "file:x" } },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: { kind: "device", id: "device" } },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "preview", id: "browser:new", resourceId: null },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "pull-request", id: "pull-request:x", repository: "owner/repo", number: 1 },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "side-chat", id: "side-chat:x" },
    },
  ])("discards incomplete saved views %j while retaining valid history", async (entry) => {
    const id = useClosedViewStore.getState().remember(files(refA));
    const { storage, name } = useClosedViewStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: { entries: [entry as ClosedViewEntry, ...useClosedViewStore.getState().entries] },
      version: 1,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.persist.hasHydrated()).toBe(true);
    expect(useClosedViewStore.getState().entries).toEqual([{ ...files(refA), id }]);
    expect(() => useClosedViewStore.getState().remember(files(refB))).not.toThrow();
  });

  it("removes malformed entries from history saved by earlier versions", async () => {
    const store = useClosedViewStore.getState();
    const sideChatId = store.remember({
      kind: "panel-tab",
      threadRef: refA,
      surface: { id: "side-chat:side", kind: "side-chat", threadId: ThreadId.make("side") },
    });
    const publicId = store.remember(files(refA));
    const { storage, name } = useClosedViewStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: {
        entries: [
          null,
          {},
          { kind: "browser" },
          { kind: "browser", snapshot: null },
          ...useClosedViewStore.getState().entries,
        ] as ClosedViewEntry[],
      },
      version: 0,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.persist.hasHydrated()).toBe(true);
    expect(useClosedViewStore.getState().entries.map((entry) => entry.id)).toEqual([
      publicId,
      sideChatId,
    ]);
  });
});
