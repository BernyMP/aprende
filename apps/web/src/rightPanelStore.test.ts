import { scopeThreadRef } from "@aprende/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@aprende/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "./closedViewStore";
import { reopenClosedView } from "./reopenClosedView";
import {
  hostRightPanel,
  migratePersistedRightPanelState,
  pullRequestSurface,
  pullRequestSurfaceId,
  selectActiveRightPanelSurface,
  selectThreadPanelVisibility,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
});

describe("rightPanelStore", () => {
  it("opens a hosted side chat's panel actions in its parent's panel until unhosted", () => {
    const store = useRightPanelStore.getState();
    const unhost = hostRightPanel(refB, refA);
    store.openFile(refB, "src/app.ts");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "file:src/app.ts",
    );
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB).surfaces,
    ).toEqual([]);
    unhost();
    store.openFile(refB, "src/app.ts");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refB)?.id).toBe(
      "file:src/app.ts",
    );
  });

  it("records single and bulk tab closes, newest first", () => {
    const store = useRightPanelStore.getState();
    const pr = pullRequestSurface({
      projectId: "project-a",
      repository: "BernyMP/aprende",
      number: 42,
    });
    store.openFile(refA, "src/app.ts");
    store.openFile(refA, "src/b.ts");
    store.openPullRequest(refA, pr);
    store.openFile(refA, "src/other.ts");
    store.closeSurface(refA, pr.id);
    store.closeSurfacesToRight(refA, "file:src/b.ts");
    store.closeOtherSurfaces(refA, "file:src/app.ts");
    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface.id : null)),
    ).toEqual(["file:src/b.ts", "file:src/other.ts", pr.id]);
  });

  it("reopens the active tab first after a bulk close", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "files");
    store.openPullRequest(refA, {
      projectId: "project-a",
      repository: "BernyMP/aprende",
      number: 7,
    });
    store.openSideChat(refA, ThreadId.make("side"));
    store.activateSurface(refA, "side-chat:side");
    store.closeAllSurfaces(refA);

    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => entry.kind === "panel-tab" && entry.surface.id),
    ).toEqual(["side-chat:side", expect.stringMatching(/^pull-request:/), "files"]);
  });

  it("does not save an incidental Files replacement when opening an existing file", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/app.ts");
    store.open(refA, "files");
    store.openFile(refA, "src/app.ts");

    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it("records only closed tabs when a panel is hidden", () => {
    const store = useRightPanelStore.getState();
    store.openSideChat(refA, ThreadId.make("side"));
    store.openFile(refA, "src/app.ts");
    store.closeSurface(refA, "file:src/app.ts");
    store.close(refA);
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", threadRef: refA, surface: { id: "file:src/app.ts" } },
    ]);
    store.toggleVisibility(refA);
    store.toggle(refA, "files");
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", threadRef: refA, surface: { id: "file:src/app.ts" } },
    ]);
    expect(useClosedViewStore.getState().entries).toHaveLength(1);
  });

  it("keeps a maximized panel per thread", () => {
    const store = useRightPanelStore.getState();
    store.openSideChat(refA, ThreadId.make("side"));
    store.open(refB, "files");
    store.setMaximized(refA, true);
    store.setMaximized(refB, true);
    store.setMaximized(refB, false);

    const { byThreadKey } = useRightPanelStore.getState();
    expect(selectThreadRightPanelState(byThreadKey, refA).maximized).toBe(true);
    expect(selectThreadRightPanelState(byThreadKey, refB).maximized).toBeUndefined();
  });

  it("restores a saved maximized panel during migration", () => {
    const migrated = migratePersistedRightPanelState({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: "files",
          surfaces: [{ id: "files", kind: "files" }],
          maximized: true,
        },
      },
    });
    expect(selectThreadRightPanelState(migrated.byThreadKey, refA).maximized).toBe(true);
  });

  it("upgrades the legacy singleton pull request surface to a reference-keyed tab", () => {
    const id = pullRequestSurfaceId({
      projectId: "project-a",
      repository: "BernyMP/aprende",
      number: 4909,
    });
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "pull-request",
            surfaces: [
              {
                id: "pull-request",
                kind: "pull-request",
                projectId: "project-a",
                repository: "BernyMP/aprende",
                number: 4909,
              },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: true,
          activeSurfaceId: id,
          surfaces: [
            {
              id,
              kind: "pull-request",
              projectId: "project-a",
              repository: "BernyMP/aprende",
              number: 4909,
            },
          ],
        },
      },
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it("drops the pull-request list's shared panel so a restart opens the page fresh", () => {
    const id = pullRequestSurfaceId({
      projectId: "project-a",
      repository: "BernyMP/aprende",
      number: 4909,
    });
    const panelState = {
      isOpen: true,
      activeSurfaceId: id,
      surfaces: [
        {
          id,
          kind: "pull-request" as const,
          projectId: "project-a",
          repository: "BernyMP/aprende",
          number: 4909,
        },
      ],
    };
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:pull-requests-panel": panelState,
          "env-1:thread-A": panelState,
        },
      }),
    ).toEqual({
      byThreadKey: { "env-1:thread-A": panelState },
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it.each([
    { kind: "plan", isOpen: true },
    { kind: "agents", isOpen: true },
    { kind: "agents", isOpen: false },
    { kind: "diff", isOpen: true },
    { kind: "terminal", isOpen: true },
    { kind: "preview", isOpen: true },
    { kind: "device", isOpen: true },
  ])("drops $kind with isOpen=$isOpen and falls back", ({ kind, isOpen }) => {
    expect(
      migratePersistedRightPanelState({
        byThreadKey: {
          "env-1:thread-A": {
            isOpen,
            activeSurfaceId: kind,
            surfaces: [{ id: kind, kind }],
          },
          "env-1:thread-B": {
            isOpen,
            activeSurfaceId: kind,
            surfaces: [
              { id: kind, kind },
              { id: "files", kind: "files" },
            ],
          },
        },
      }),
    ).toEqual({
      byThreadKey: {
        "env-1:thread-A": {
          isOpen: false,
          activeSurfaceId: null,
          surfaces: [],
        },
        "env-1:thread-B": {
          isOpen,
          activeSurfaceId: "files",
          surfaces: [{ id: "files", kind: "files" }],
        },
      },
      threadPanelVisibilityByThreadKey: {},
    });
  });

  it("persists inline preference without restoring an open popover", () => {
    expect(
      migratePersistedRightPanelState({
        threadPanelVisibilityByThreadKey: {
          "env-1:thread-A": { inlineOpen: false, popoverOpen: true },
          "env-1:thread-B": { inlineOpen: true, popoverOpen: true },
        },
      }),
    ).toEqual({
      byThreadKey: {},
      threadPanelVisibilityByThreadKey: {
        "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
      },
    });
  });

  it("closes the popover atomically when the real right panel opens", () => {
    useRightPanelStore.getState().setThreadPanelOpen(refA, "popover", true);
    useRightPanelStore.getState().open(refA, "files");

    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refA,
      ),
    ).toEqual({ inlineOpen: true, popoverOpen: false });
  });

  it("keeps an open popover visible by promoting it to inline when the real panel closes", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "files");
    store.setThreadPanelOpen(refA, "inline", false);
    store.setThreadPanelOpen(refA, "popover", true);
    store.close(refA);

    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refA,
      ),
    ).toEqual({ inlineOpen: true, popoverOpen: true });
  });

  it("opens workspace-root links as the singleton files explorer", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "README.md");
    store.openFile(refA, ".");
    store.openFile(refA, ".");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("files");
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    store.closeSurface(refA, "files");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).activeSurfaceId,
    ).toBe("file:README.md");
    store.openFile(refA, ".");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).activeSurfaceId,
    ).toBe("files");
  });

  it("walks a folder browser up and back down in one tab", () => {
    const store = useRightPanelStore.getState();
    const state = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.openFile(refA, "README.md");
    store.openFile(refA, "apps/web/src");

    store.navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");
    expect(state().activeSurfaceId).toBe("file:apps");
    expect(state().surfaces).toEqual([
      expect.objectContaining({ id: "file:README.md" }),
      expect.objectContaining({
        id: "file:apps",
        relativePath: "apps",
        folderTrail: "apps/web/src",
      }),
    ]);

    store.navigateFolder(refA, "file:apps", "", "apps/web/src");
    expect(state().surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    expect(state().surfaces[1]).toEqual({
      id: "files",
      kind: "files",
      folderTrail: "apps/web/src",
    });

    store.navigateFolder(refA, "files", "apps/web/src", "apps/web/src");
    expect(state().activeSurfaceId).toBe("file:apps/web/src");
    expect(state().surfaces[1]).toEqual({
      id: "file:apps/web/src",
      kind: "file",
      relativePath: "apps/web/src",
      revealLine: null,
      revealRequestId: 1,
    });
  });

  it("switches to a tab that already shows the folder instead of replacing it", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "apps");
    store.openFile(refA, "apps/web/src", 12);

    store.navigateFolder(refA, "file:apps/web/src", "apps", "apps/web/src");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.activeSurfaceId).toBe("file:apps");
    expect(state.surfaces).toEqual([
      { id: "file:apps", kind: "file", relativePath: "apps", revealLine: null, revealRequestId: 1 },
    ]);
  });

  it("keeps a file's tab when walking up from it, and comes back to it", () => {
    const store = useRightPanelStore.getState();
    const state = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.openFile(refA, "src/app.ts", 40);

    store.navigateFolder(refA, "file:src/app.ts", "src", "src/app.ts", true);
    expect(state().activeSurfaceId).toBe("file:src");
    expect(state().surfaces).toEqual([
      {
        id: "file:src/app.ts",
        kind: "file",
        relativePath: "src/app.ts",
        revealLine: 40,
        revealRequestId: 1,
      },
      expect.objectContaining({ id: "file:src", folderTrail: "src/app.ts" }),
    ]);

    store.navigateFolder(refA, "file:src", "src/app.ts", "src/app.ts");
    expect(state().activeSurfaceId).toBe("file:src/app.ts");
    expect(state().surfaces).toEqual([
      {
        id: "file:src/app.ts",
        kind: "file",
        relativePath: "src/app.ts",
        revealLine: 40,
        revealRequestId: 1,
      },
    ]);
  });

  // regression: #15045 breadcrumb navigation from a closed tab must not resurrect it
  it("ignores navigation from a tab that was closed", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "apps");
    const before = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    store.navigateFolder(refA, "file:gone", "", "gone");
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toBe(
      before,
    );
  });

  it("replaces the standalone explorer with peer file surfaces", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "README.md");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:README.md",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 2,
        },
        {
          id: "file:README.md",
          kind: "file",
          relativePath: "README.md",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it.each([
    ["generated\\", "generated"],
    ["notes/meeting ", "notes/meeting"],
    [" notes/meeting", "notes/meeting"],
  ])("keeps %j and %j in separate file tabs", (firstPath, secondPath) => {
    useRightPanelStore.getState().openFile(refA, firstPath);
    useRightPanelStore.getState().openFile(refA, secondPath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces,
    ).toMatchObject([
      { id: `file:${firstPath}`, relativePath: firstPath },
      { id: `file:${secondPath}`, relativePath: secondPath },
    ]);
  });

  it("keeps attachment and workspace file ids disjoint", () => {
    useRightPanelStore.getState().openFile(refA, "attachment:shared-id");
    useRightPanelStore.getState().openAttachment(refA, {
      type: "file",
      id: "shared-id",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["file:attachment:shared-id", "attachment:shared-id"]);
  });

  it("updates line reveal requests when reopening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 42);
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 87);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 87,
          revealRequestId: 2,
        },
      ],
    });

    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 3,
        },
      ],
    });
  });

  it("removes persisted file surfaces when their workspace no longer exists", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openSideChat(refA, ThreadId.make("side"));
    useRightPanelStore.getState().openFile(refA, "README.md");

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "side-chat:side",
      surfaces: [{ id: "side-chat:side", kind: "side-chat", threadId: "side" }],
    });

    useRightPanelStore.getState().openFile(refB, "conductor.json");
    useRightPanelStore.getState().reconcileFileSurfaces(refB, false);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refB)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("keeps attachment previews when their workspace is unavailable", () => {
    const attachment = {
      type: "file" as const,
      id: "thread-A-attachment-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };
    useRightPanelStore.getState().openFile(refA, "README.md");
    useRightPanelStore.getState().openAttachment(refA, attachment);

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "attachment:thread-A-attachment-pdf",
      surfaces: [
        {
          id: "attachment:thread-A-attachment-pdf",
          kind: "file",
          relativePath: "report.pdf",
          revealLine: null,
          revealRequestId: 0,
          attachment,
        },
      ],
    });
  });

  it("tracks one surface per pull request", () => {
    const first = { projectId: "project-a", repository: "BernyMP/aprende", number: 4909 };
    const second = { projectId: "project-a", repository: "BernyMP/aprende", number: 4910 };
    useRightPanelStore.getState().openPullRequest(refA, first);
    useRightPanelStore.getState().openPullRequest(refA, second);
    const url = "https://gitlab.example.com/BernyMP/aprende/-/merge_requests/4909";
    useRightPanelStore.getState().openPullRequest(refA, { ...first, url });
    useRightPanelStore.getState().openPullRequest(refA, first);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(first),
      pullRequestSurfaceId(second),
    ]);
    expect(state.activeSurfaceId).toBe(pullRequestSurfaceId(first));
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA),
    ).toMatchObject({ url });
    expect(state.surfaces[1]).not.toHaveProperty("url");
  });

  it("restores each environment, thread and PR surface's detail tab after reload and URL reopen", async () => {
    const pr = { projectId: "project-a", repository: "BernyMP/aprende", number: 4909 };
    const otherPr = { ...pr, projectId: "project-b" };
    const otherEnvironment = scopeThreadRef("env-2" as EnvironmentId, refA.threadId);
    const selections = [
      [refA, pr, "code"],
      [refB, pr, "guide"],
      [otherEnvironment, pr, "timeline"],
      [refA, otherPr, "summary"],
    ] as const;
    const store = useRightPanelStore.getState();
    for (const [ref, reference, tab] of selections) {
      store.openPullRequest(ref, reference);
      store.setPullRequestDetailTab(ref, pullRequestSurfaceId(reference), "guide");
      store.setPullRequestDetailTab(ref, pullRequestSurfaceId(reference), tab);
    }

    const { storage, name } = useRightPanelStore.persist.getOptions();
    const saved = await storage!.getItem(name!);
    expect(saved).not.toBeNull();
    useRightPanelStore.setState({ byThreadKey: {} });
    await storage!.setItem(name!, saved!);
    await useRightPanelStore.persist.rehydrate();

    for (const [ref, reference, tab] of selections) {
      store.openPullRequest(ref, {
        ...reference,
        url: `https://github.com/${reference.repository}/pull/${reference.number}`,
      });
      const active = selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref);
      expect(active?.id).toBe(pullRequestSurfaceId(reference));
      expect(active?.kind === "pull-request" && (active.detailTab ?? "summary")).toBe(tab);
      store.closeSurface(ref, active!.id);
      reopenClosedView(useClosedViewStore.getState().entries[0]!, { workspaceAvailable: true });
      const reopened = selectActiveRightPanelSurface(
        useRightPanelStore.getState().byThreadKey,
        ref,
      );
      expect(reopened?.kind === "pull-request" && (reopened.detailTab ?? "summary")).toBe(tab);
    }
  });

  it("keeps matching repository and number on different hosts as separate tabs", () => {
    const first = { projectId: "project-a", repository: "acme/api", number: 7, host: "github.com" };
    const second = { ...first, host: "github.example.com" };
    useRightPanelStore.getState().openPullRequest(refA, first);
    useRightPanelStore.getState().openPullRequest(refA, second);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(state.surfaces).toEqual([pullRequestSurface(first), pullRequestSurface(second)]);
    expect(pullRequestSurfaceId({ ...first, host: "GITHUB.COM" })).toBe(
      pullRequestSurfaceId(first),
    );
  });

  it("keeps the page's panel tabs reachable when the set of connected servers changes", () => {
    const panelId = ThreadId.make("pull-requests-panel");
    const stableRef = scopeThreadRef("pull-requests-panel" as EnvironmentId, panelId);
    const fromServerA = {
      environmentId: "server-a",
      projectId: "project-a",
      repository: "BernyMP/aprende",
      number: 1,
    };
    const fromServerB = {
      environmentId: "server-b",
      projectId: "project-b",
      repository: "BernyMP/aprende",
      number: 2,
    };

    useRightPanelStore.getState().openPullRequest(stableRef, fromServerA);
    useRightPanelStore.getState().openPullRequest(stableRef, fromServerB);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, stableRef);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(fromServerA),
      pullRequestSurfaceId(fromServerB),
    ]);

    const refWhileBothConnected = scopeThreadRef("server-a" as EnvironmentId, panelId);
    const refAfterServerADisconnects = scopeThreadRef("server-b" as EnvironmentId, panelId);
    expect(refWhileBothConnected).not.toEqual(refAfterServerADisconnects);
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        refAfterServerADisconnects,
      ).surfaces,
    ).toEqual([]);
  });

  it("closing the active surface activates a neighboring surface", () => {
    useRightPanelStore.getState().openSideChat(refA, ThreadId.make("side"));
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().closeSurface(refA, "file:src/index.ts");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, refA)?.id).toBe(
      "side-chat:side",
    );
  });

  it("closing surfaces to the right activates the selected surface when active was removed", () => {
    useRightPanelStore.getState().openSideChat(refA, ThreadId.make("side"));
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/other.ts");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "side-chat:side");

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: "side-chat:side",
      surfaces: [{ id: "side-chat:side", kind: "side-chat", threadId: "side" }],
    });
  });

  it("moves a surface to a new index", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/a.ts");
    store.openSideChat(refA, ThreadId.make("side"));
    store.open(refA, "files");
    const surfaceIds = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).surfaces.map(
        (surface) => surface.id,
      );

    store.moveSurface(refA, "side-chat:side", 0);
    expect(surfaceIds()).toEqual(["side-chat:side", "file:src/a.ts", "files"]);
    store.moveSurface(refA, "side-chat:side", 2);
    expect(surfaceIds()).toEqual(["file:src/a.ts", "files", "side-chat:side"]);
  });
});
