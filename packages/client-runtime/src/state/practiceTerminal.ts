import { LEARNING_TERMINAL_SCROLLBACK_CHARS, type LearningTerminalEvent } from "@aprende/contracts";

/** A practice terminal's output as the client holds it. */
export interface PracticeTerminalView {
  /** The latest output; at least the scrollback cap when there is that much. */
  readonly text: string;
  /** Identifies the snapshot `text` builds on; a new one, even after a reconnect, replaces everything shown. */
  readonly snapshot: object;
  /** Characters appended to `text` since the last snapshot. */
  readonly appended: number;
  /** Set once the shell ended; null exit code when it was closed or was not running. */
  readonly ended: { readonly exitCode: number | null } | null;
}

export const EMPTY_PRACTICE_TERMINAL: PracticeTerminalView = {
  text: "",
  snapshot: {},
  appended: 0,
  ended: null,
};

export function applyPracticeTerminalEvent(
  view: PracticeTerminalView,
  event: LearningTerminalEvent,
): PracticeTerminalView {
  switch (event.type) {
    case "snapshot":
      return { text: event.data, snapshot: {}, appended: 0, ended: null };
    case "output": {
      const text = view.text + event.data;
      return {
        ...view,
        // Trimming only past twice the cap keeps each chunk from copying the whole scrollback.
        text:
          text.length > 2 * LEARNING_TERMINAL_SCROLLBACK_CHARS
            ? text.slice(-LEARNING_TERMINAL_SCROLLBACK_CHARS)
            : text,
        appended: view.appended + event.data.length,
      };
    }
    case "ended":
      return { ...view, ended: { exitCode: event.exitCode } };
  }
}

/** What a terminal that shows `shown` must do to show `view`. */
export function practiceTerminalUpdate(
  shown: Pick<PracticeTerminalView, "snapshot" | "appended">,
  view: PracticeTerminalView,
): { readonly reset: boolean; readonly data: string } {
  const unshown = view.appended - shown.appended;
  if (view.snapshot !== shown.snapshot || unshown < 0 || unshown > view.text.length)
    return { reset: true, data: view.text };
  return { reset: false, data: unshown === 0 ? "" : view.text.slice(-unshown) };
}
