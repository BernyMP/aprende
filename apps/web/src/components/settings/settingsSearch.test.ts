import { describe, expect, it, vi } from "vite-plus/test";

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  isSettingsSearchScopeAvailable,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
    searchTerms: ["long lines in code previews"],
  },
  {
    id: "open-source-licenses",
    title: "Open source licenses",
    to: "/settings/about",
    searchTerms: ["notices dependencies"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["claude codex agents"],
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("matches titles, sections, and remembered setting details", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("licenses", ITEMS).map((item) => item.id)).toEqual([
      "open-source-licenses",
    ]);
    expect(searchSettings("about", ITEMS).map((item) => item.id)).toEqual(["open-source-licenses"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("composer")[0]).toMatchObject({
      id: "composer-rich-text",
      to: "/settings/general",
    });
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("render math").map((item) => item.id)).toEqual(["math-rendering"]);
    expect(searchSettings("schè\u{1ab0}me")[0]?.id).toBe("color-scheme");
    const localeLowerCase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockReturnValue("chat wıdth");
    try {
      expect(searchSettings("CHAT WIDTH")[0]?.id).toBe("chat-width");
      expect(localeLowerCase).not.toHaveBeenCalled();
    } finally {
      localeLowerCase.mockRestore();
    }
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("matches query words across fields and ranks the strongest result first", () => {
    expect(searchSettings("dependencies notices", ITEMS).map((item) => item.id)).toEqual([
      "open-source-licenses",
    ]);
    expect(searchSettings("time format")[0]?.id).toBe("time-format");
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "update-track")).toBe(true);
    expect(searchSettings("update track")).toEqual([]);
  });

  it("hides settings whose controls are unavailable", () => {
    const ids = (hasProviderSettingsEnvironment: boolean) =>
      filterAvailableSettingsSearchItems({ hasProviderSettingsEnvironment }).map((item) => item.id);
    expect(ids(false)).not.toContain("provider-health-check-interval");
    expect(ids(true)).toContain("provider-health-check-interval");
    // Detail pages are not offered in search.
    expect(ids(true)).not.toContain("snap-shot-enabled");
  });

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
    expect(searchSettings("diff.toggle").map((item) => item.id)).not.toContain(
      "keybinding-diff.toggle",
    );
  });

  it("sends commands without a default binding to the section", () => {
    expect(searchSettings("thread.stop")[0]).toMatchObject({
      id: "keybinding-thread.stop",
      targetId: "keybindings",
    });
    expect(searchSettings("sidebar.toggle")[0]?.targetId).toBeUndefined();
  });

  it("finds rows by the titles shown on their pages", () => {
    for (const [title, id] of [
      ["Native sessions", "providers"],
      ["CODEX_HOME path", "providers"],
      ["Shadow home path", "providers"],
    ] as const) {
      expect(searchSettings(title)[0]?.id, title).toBe(id);
    }
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("settings search targets", () => {
  it("requires an environment for the resolved telemetry export destination", () => {
    const result = searchSettings("OpenTelemetry export").find(
      (item) => item.id === "telemetry-export",
    )!;
    const target = getSettingsSearchTargetScope(result.targetId ?? result.id)!;
    expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "project")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "environment")).toBe(true);
  });
});
