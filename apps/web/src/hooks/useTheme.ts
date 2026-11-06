import type { DesktopBridge } from "@aprende/contracts";
import { safeErrorLogAttributes } from "@aprende/client-runtime/errors";
import type { ThemeAppearance } from "@aprende/shared/themePalettes";
import { useSyncExternalStore } from "react";

export type AppearanceMode = ThemeAppearance | "system";
type ThemeSnapshot = Readonly<{ appearanceMode: AppearanceMode; resolvedTheme: ThemeAppearance }>;

// index.html's boot script reads this key too.
export const THEME_APPEARANCE_MODE_STORAGE_KEY = "aprende:theme-appearance-mode";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_SNAPSHOT: ThemeSnapshot = { appearanceMode: "system", resolvedTheme: "light" };
const THEME_COLOR_META_NAME = "theme-color";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopMode: AppearanceMode | null = null;

function isAppearanceMode(value: string | null): value is AppearanceMode {
  return value === "light" || value === "dark" || value === "system";
}

function readAppearanceMode(): AppearanceMode {
  try {
    const raw = window.localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
    if (isAppearanceMode(raw)) return raw;
  } catch {}
  return "system";
}

function getSystemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(MEDIA_QUERY).matches;
}

function resolveAppearance(mode: AppearanceMode): ThemeAppearance {
  if (mode !== "system") return mode;
  return getSystemDark() ? "dark" : "light";
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue("--app-chrome-background")
    .trim();
  if (!color) return;

  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  for (const element of document.querySelectorAll<HTMLMetaElement>(
    `meta[name="${THEME_COLOR_META_NAME}"]`,
  )) {
    element.setAttribute("content", color);
  }
}

function syncDesktopTheme(mode: AppearanceMode) {
  const bridge: Pick<DesktopBridge, "setTheme"> | undefined = window.desktopBridge;
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopMode === mode) return;
  lastDesktopMode = mode;
  bridge.setTheme(mode).catch((cause: unknown) => {
    console.error(`Failed to sync the ${mode} appearance to the desktop shell.`, {
      ...safeErrorLogAttributes(cause),
    });
    if (lastDesktopMode === mode) lastDesktopMode = null;
  });
}

function applyTheme({ suppressTransitions = false } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const mode = readAppearanceMode();
  const root = document.documentElement;
  if (suppressTransitions) root.classList.add("no-transitions");
  root.classList.toggle("dark", resolveAppearance(mode) === "dark");
  syncBrowserChromeTheme();
  syncDesktopTheme(mode);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove("no-transitions"));
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme();
}

function emitChange() {
  lastSnapshot = null;
  for (const listener of listeners) listener();
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_SNAPSHOT;
  // Cached until emitChange; useTheme calls this every render.
  if (lastSnapshot) return lastSnapshot;
  const appearanceMode = readAppearanceMode();
  lastSnapshot = { appearanceMode, resolvedTheme: resolveAppearance(appearanceMode) };
  return lastSnapshot;
}

function handleExternalChange() {
  applyTheme({ suppressTransitions: true });
  emitChange();
}

function handleStorageChange(event: StorageEvent) {
  if (event.key === THEME_APPEARANCE_MODE_STORAGE_KEY || event.key === null) {
    handleExternalChange();
  }
}

let removeWindowListeners: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  if (!removeWindowListeners) {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
    mq?.addEventListener("change", handleExternalChange);
    window.addEventListener("storage", handleStorageChange);
    removeWindowListeners = () => {
      mq?.removeEventListener("change", handleExternalChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    if (listeners.length === 0) {
      removeWindowListeners?.();
      removeWindowListeners = null;
    }
  };
}

/** For shortcuts and other handlers outside React that read the theme at event time. */
export function getThemeSnapshot(): ThemeSnapshot {
  return getSnapshot();
}

/** For code outside React (worker pools) that follows the rendered appearance. */
export const subscribeRenderedAppearance = subscribe;

export function getRenderedAppearance(): ThemeAppearance {
  return getSnapshot().resolvedTheme;
}

export function useRenderedAppearance(): ThemeAppearance {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SNAPSHOT).resolvedTheme;
}

export function setAppearanceMode(next: AppearanceMode): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(THEME_APPEARANCE_MODE_STORAGE_KEY, next);
  } catch (cause) {
    console.error("Failed to save the appearance preference.", {
      storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
      ...safeErrorLogAttributes(cause),
    });
    return false;
  }
  applyTheme({ suppressTransitions: true });
  emitChange();
  return true;
}

export function useTheme() {
  const { appearanceMode, resolvedTheme } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_SNAPSHOT,
  );
  return { appearanceMode, resolvedTheme, setAppearanceMode } as const;
}
