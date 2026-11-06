import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

export const APPEARANCE_OPTIONS = [
  { mode: "system", label: "System", icon: MonitorIcon },
  { mode: "light", label: "Light", icon: SunIcon },
  { mode: "dark", label: "Dark", icon: MoonIcon },
] as const;

export function notifyThemeSaveFailure(): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Couldn't save the color scheme",
      description: "Try again.",
    }),
  );
}

export function useChangeAppearanceItem(): CommandPaletteSubmenuItem {
  const { appearanceMode, setAppearanceMode } = useTheme();
  return {
    kind: "submenu",
    value: "action:change-appearance",
    searchTerms: ["change appearance", "light", "dark", "system", "mode", "toggle", "theme"],
    title: "Change appearance",
    icon: <MonitorIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <MonitorIcon className={ADDON_ICON_CLASS} />,
    shortcutCommand: "appearance.cycle",
    groups: [
      {
        value: "appearance",
        label: "Change appearance",
        items: APPEARANCE_OPTIONS.map(({ mode, label, icon: Icon }) => ({
          kind: "action",
          value: `appearance:${mode}`,
          title: label,
          searchTerms: [label, "appearance", "mode"],
          icon: <Icon className={ITEM_ICON_CLASS} />,
          titleTrailingContent:
            appearanceMode === mode ? (
              <span className="text-xs text-muted-foreground/70">Current</span>
            ) : undefined,
          run: async () => {
            if (!setAppearanceMode(mode)) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };
}
