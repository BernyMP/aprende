import type { AnyRouter } from "@tanstack/react-router";

import {
  dispatchCommandPalette,
  isCommandPaletteMounted,
  useCommandPaletteStore,
} from "../commandPaletteStore";
import { overlayModeForCommand } from "../components/CommandPalette.logic";
import {
  APPEARANCE_OPTIONS,
  notifyThemeSaveFailure,
} from "../components/CommandPaletteAppearanceItem";
import { toastManager } from "../components/ui/toast";
import { getThemeSnapshot, setAppearanceMode } from "../hooks/useTheme";
import { type CommandHandler, type CommandScopeOptions, registerCommands } from "./dispatcher";

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

const toggleOverlay =
  (command: Parameters<typeof overlayModeForCommand>[0]): CommandHandler =>
  (event) => {
    const mode = overlayModeForCommand(command);
    if (mode === null) return false;
    consume(event);
    dispatchCommandPalette({ _tag: "ToggleMode", mode });
  };

/**
 * Palette, theme and usage shortcuts. They read the route, panels and theme
 * when the key is pressed, and are live only while the palette is mounted.
 */
export function installCommandPaletteCommands(
  router: AnyRouter,
  options: Pick<CommandScopeOptions, "keybindings"> = {},
): () => void {
  // A child search (files, contents) goes back to the palette on Escape before
  // its own widgets or the dialog can treat the key as a close.
  const disposeEscape = registerCommands(
    {},
    {
      capture: true,
      when: isCommandPaletteMounted,
      onKeyDown: (event) => {
        if (event.isComposing || event.key !== "Escape") return false;
        const { open, mode } = useCommandPaletteStore.getState();
        if (!open || mode === "command") return false;
        consume(event);
        dispatchCommandPalette({ _tag: "BackToCommand" });
      },
    },
  );

  const disposeCommands = registerCommands(
    {
      "appearance.cycle": (event) => {
        consume(event);
        if (event.repeat) return;
        const { appearanceMode } = getThemeSnapshot();
        const nextMode =
          appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
        if (!setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
          return;
        }
        toastManager.add({
          id: "appearance-cycle",
          title: `Appearance: ${APPEARANCE_OPTIONS.find((option) => option.mode === nextMode)?.label}`,
          timeout: 1500,
        });
      },
      "usage.open": (event) => {
        consume(event);
        dispatchCommandPalette({ _tag: "SetOpen", open: false });
        void router.navigate({ to: "/usage" });
      },
      "knowledge.open": (event) => {
        consume(event);
        dispatchCommandPalette({ _tag: "SetOpen", open: false });
        void router.navigate({ to: "/knowledge" });
      },
      "commandPalette.toggle": toggleOverlay("commandPalette.toggle"),
      "filePicker.toggle": toggleOverlay("filePicker.toggle"),
      "projectSearch.toggle": toggleOverlay("projectSearch.toggle"),
    },
    {
      ...options,
      when: isCommandPaletteMounted,
      context: () => ({ usagePageOpen: router.state.location.pathname === "/usage" }),
    },
  );

  return () => {
    disposeEscape();
    disposeCommands();
  };
}
