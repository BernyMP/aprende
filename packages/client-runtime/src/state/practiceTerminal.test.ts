import {
  LEARNING_TERMINAL_SCROLLBACK_CHARS,
  LEARNING_TERMINAL_WRITE_MAX_CHARS,
} from "@aprende/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyPracticeTerminalEvent,
  EMPTY_PRACTICE_TERMINAL,
  PRACTICE_TERMINAL_PENDING_CHARS,
  PracticeTerminalInput,
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

describe("PracticeTerminalInput", () => {
  it("splits a large paste into writes under the limit, in order, without breaking characters", async () => {
    const sent: Array<string> = [];
    const input = new PracticeTerminalInput(async (data) => {
      sent.push(data);
      return true;
    });
    const paste = `${"a".repeat(LEARNING_TERMINAL_WRITE_MAX_CHARS - 1)}😀${"b".repeat(LEARNING_TERMINAL_WRITE_MAX_CHARS)}`;
    expect(input.type(paste)).toBe(true);
    await input.flush();
    expect(sent.join("")).toBe(paste);
    expect(sent.every((data) => data.length <= LEARNING_TERMINAL_WRITE_MAX_CHARS)).toBe(true);
    expect(sent[0]).toBe("a".repeat(LEARNING_TERMINAL_WRITE_MAX_CHARS - 1));
  });

  it("sends one write at a time and keeps input until a write of it succeeds", async () => {
    const sent: Array<string> = [];
    const first = Promise.withResolvers<boolean>();
    const results = [first.promise, Promise.resolve(false), Promise.resolve(true)];
    const input = new PracticeTerminalInput((data) => {
      sent.push(data);
      return results[sent.length - 1] ?? Promise.resolve(true);
    });

    input.type("l");
    const flushing = input.flush();
    // Typed while a write is in flight: it waits for that write, then goes next.
    input.type("s");
    await input.flush();
    expect(sent).toEqual(["l"]);
    first.resolve(true);
    await flushing;
    // That write failed, so "s" stays queued and goes again, ahead of what is typed next.
    expect(sent).toEqual(["l", "s"]);
    input.type("\r");
    await input.flush();
    expect(sent).toEqual(["l", "s", "s\r"]);
  });

  it("refuses input past the pending limit and keeps what was already queued", async () => {
    const sent: Array<string> = [];
    const input = new PracticeTerminalInput(async (data) => {
      sent.push(data);
      return true;
    });
    expect(input.type("ls")).toBe(true);
    expect(input.type("x".repeat(PRACTICE_TERMINAL_PENDING_CHARS))).toBe(false);
    await input.flush();
    expect(sent).toEqual(["ls"]);
  });
});
