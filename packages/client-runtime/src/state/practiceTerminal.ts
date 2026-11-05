import {
  LEARNING_TERMINAL_SCROLLBACK_CHARS,
  LEARNING_TERMINAL_WRITE_MAX_CHARS,
  type LearningTerminalEvent,
} from "@aprende/contracts";

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

/** The most typed or pasted input a practice terminal holds while earlier input is still sending. */
export const PRACTICE_TERMINAL_PENDING_CHARS = 1024 * 1024;

/**
 * Sends a terminal's input in order, one write at a time, each under the write limit.
 * Input stays queued until a write of it succeeds; a failed write stops sending until the next flush.
 */
export class PracticeTerminalInput {
  private pending = "";
  private sending = false;
  // Bumped by `clear`, so a write still in flight cannot trim input queued after it.
  private generation = 0;
  private readonly send: (data: string) => Promise<boolean>;

  constructor(send: (data: string) => Promise<boolean>) {
    this.send = send;
  }

  /** Queues input; false, queuing none of it, when that would pass the pending limit. */
  type(data: string): boolean {
    if (this.pending.length + data.length > PRACTICE_TERMINAL_PENDING_CHARS) return false;
    this.pending += data;
    return true;
  }

  /** Drops queued input, as when a new shell starts. */
  clear(): void {
    this.pending = "";
    this.generation++;
  }

  /** Sends queued input until none is left or a write fails. Does nothing while already sending. */
  async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.pending.length > 0) {
        const generation = this.generation;
        const chunk = nextChunk(this.pending);
        if (!(await this.send(chunk))) return;
        if (generation === this.generation) this.pending = this.pending.slice(chunk.length);
      }
    } finally {
      this.sending = false;
    }
  }
}

// Never ends a chunk between the two halves of a surrogate pair.
function nextChunk(text: string): string {
  if (text.length <= LEARNING_TERMINAL_WRITE_MAX_CHARS) return text;
  const last = text.charCodeAt(LEARNING_TERMINAL_WRITE_MAX_CHARS - 1);
  const end =
    last >= 0xd800 && last <= 0xdbff
      ? LEARNING_TERMINAL_WRITE_MAX_CHARS - 1
      : LEARNING_TERMINAL_WRITE_MAX_CHARS;
  return text.slice(0, end);
}
