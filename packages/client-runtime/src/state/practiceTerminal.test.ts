import { LEARNING_TERMINAL_SCROLLBACK_CHARS } from "@aprende/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyPracticeTerminalEvent,
  EMPTY_PRACTICE_TERMINAL,
  practiceTerminalUpdate,
} from "./practiceTerminal.ts";

describe("practiceTerminalUpdate", () => {
  it("writes only unseen output, and redraws after a snapshot or a trimmed gap", () => {
    let view = applyPracticeTerminalEvent(EMPTY_PRACTICE_TERMINAL, {
      type: "snapshot",
      data: "$ ",
    });
    expect(practiceTerminalUpdate(EMPTY_PRACTICE_TERMINAL, view)).toEqual({
      reset: true,
      data: "$ ",
    });
    const shown = view;

    // Renders can skip views; whatever arrived since the last shown one is written once.
    view = applyPracticeTerminalEvent(view, { type: "output", data: "ls\r\n" });
    view = applyPracticeTerminalEvent(view, { type: "output", data: "main.py\r\n" });
    expect(practiceTerminalUpdate(shown, view)).toEqual({
      reset: false,
      data: "ls\r\nmain.py\r\n",
    });
    expect(practiceTerminalUpdate(view, view)).toEqual({ reset: false, data: "" });

    // More output than the client keeps cannot be appended; it redraws what it has.
    const flood = "x".repeat(2 * LEARNING_TERMINAL_SCROLLBACK_CHARS);
    const flooded = applyPracticeTerminalEvent(view, { type: "output", data: flood });
    expect(flooded.text).toBe(flood.slice(-LEARNING_TERMINAL_SCROLLBACK_CHARS));
    expect(practiceTerminalUpdate(view, flooded)).toEqual({ reset: true, data: flooded.text });

    // A reconnect's snapshot replaces everything, even one with the same text as the last.
    const first = applyPracticeTerminalEvent(EMPTY_PRACTICE_TERMINAL, {
      type: "snapshot",
      data: "$ ",
    });
    const reconnected = applyPracticeTerminalEvent(EMPTY_PRACTICE_TERMINAL, {
      type: "snapshot",
      data: "$ ",
    });
    expect(practiceTerminalUpdate(first, reconnected)).toEqual({ reset: true, data: "$ " });
    expect(applyPracticeTerminalEvent(reconnected, { type: "ended", exitCode: 0 }).ended).toEqual({
      exitCode: 0,
    });
  });
});
