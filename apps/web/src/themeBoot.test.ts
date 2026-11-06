import { APP_THEME_COLORS } from "@aprende/shared/themePalettes";
import { describe, expect, it } from "vite-plus/test";

import indexHtml from "../index.html?raw";
import { THEME_APPEARANCE_MODE_STORAGE_KEY } from "./hooks/useTheme";

const bootScript = (() => {
  const match = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Could not find the inline boot script in index.html");
  return match[1];
})();

function runBootScript(options: {
  storedMode?: string | undefined;
  storageThrows?: boolean | undefined;
  prefersDark: boolean;
}) {
  const classes = new Set<string>();
  const meta = {
    content: null as string | null,
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };
  const documentElement = {
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    style: { backgroundColor: "" },
  };
  const fakeDocument = {
    documentElement,
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? [meta] : []),
  };
  const fakeWindow = {
    localStorage: {
      getItem: (key: string): string | null => {
        if (options.storageThrows) throw new Error("storage blocked");
        return key === THEME_APPEARANCE_MODE_STORAGE_KEY ? (options.storedMode ?? null) : null;
      },
    },
    matchMedia: () => ({ matches: options.prefersDark }),
  };

  new Function("window", "document", bootScript)(fakeWindow, fakeDocument);

  return {
    isDark: classes.has("dark"),
    backgroundColor: documentElement.style.backgroundColor,
    metaContent: meta.content,
  };
}

describe("index.html boot script", () => {
  it.each([
    { storedMode: undefined, prefersDark: false, expected: "light" },
    { storedMode: undefined, prefersDark: true, expected: "dark" },
    { storedMode: "system", prefersDark: true, expected: "dark" },
    { storedMode: "light", prefersDark: true, expected: "light" },
    { storedMode: "dark", prefersDark: false, expected: "dark" },
    { storedMode: "bogus", prefersDark: true, expected: "dark" },
    { storageThrows: true, prefersDark: true, expected: "dark" },
  ] as const)(
    "paints the $expected palette for mode $storedMode with OS dark $prefersDark",
    ({ expected, ...options }) => {
      const boot = runBootScript(options);
      expect(boot.isDark).toBe(expected === "dark");
      expect(boot.backgroundColor).toBe(APP_THEME_COLORS[expected].chrome);
      expect(boot.metaContent).toBe(APP_THEME_COLORS[expected].chrome);
    },
  );
});
