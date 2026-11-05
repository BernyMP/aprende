import type { EnvironmentId } from "@aprende/contracts";
import {
  EMPTY_PRACTICE_TERMINAL,
  practiceTerminalUpdate,
  type PracticeTerminalView,
} from "@aprende/client-runtime/state/practice-terminal";
import { useAtomRefresh } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { ensureLocalApi } from "~/localApi";
import type { PracticeTerminalSurface } from "~/rightPanelStore";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { terminalThemeFromApp } from "~/terminal/ghostty/appTheme";
import { GhosttyTerminalSurface } from "~/terminal/ghostty/surface";
import { Button } from "../ui/button";

type Shell = { readonly status: "starting" } | { readonly status: "running" };

/** An interactive shell in a problem's practice folder. */
export default function PracticeTerminalPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly terminal: PracticeTerminalSurface;
  readonly visible: boolean;
}) {
  const { environmentId, terminal } = props;
  const target = { threadId: terminal.threadId, problemId: terminal.problemId };
  const [surface, setSurface] = useState<GhosttyTerminalSurface | null>(null);
  const [shell, setShell] = useState<Shell>({ status: "starting" });
  const [error, setError] = useState<string | null>(null);
  const size = useRef<{ cols: number; rows: number } | null>(null);
  const shown =
    useRef<Pick<PracticeTerminalView, "snapshot" | "appended">>(EMPTY_PRACTICE_TERMINAL);
  const openShell = useAtomCommand(serverEnvironment.openPracticeTerminal, {
    label: "open the terminal",
    reportFailure: false,
  });
  const writeShell = useAtomCommand(serverEnvironment.writePracticeTerminal, {
    label: "type in the terminal",
    reportFailure: false,
  });
  const resizeShell = useAtomCommand(serverEnvironment.resizePracticeTerminal, {
    label: "resize the terminal",
    reportFailure: false,
  });
  const outputAtom = serverEnvironment.practiceTerminalOutput({ environmentId, input: target });
  const output = useEnvironmentQuery(shell.status === "running" ? outputAtom : null);
  // A new shell's output must not resume a finished subscription the registry still holds.
  const resubscribe = useAtomRefresh(outputAtom);
  const view = output.data;

  const start = async (cols: number, rows: number) => {
    setShell({ status: "starting" });
    setError(null);
    shown.current = EMPTY_PRACTICE_TERMINAL;
    const result = await openShell({ environmentId, input: { ...target, cols, rows } });
    if (result._tag !== "Success") {
      setError(formatEnvironmentQueryError(result.cause));
      return;
    }
    resubscribe();
    setShell({ status: "running" });
    const latest = size.current;
    if (latest !== null && (latest.cols !== cols || latest.rows !== rows))
      void resizeShell({ environmentId, input: { ...target, ...latest } });
  };

  // Keystrokes go one request at a time, in order; those typed meanwhile go together next.
  const typed = useRef({ pending: "", sending: false });
  const sendTyped = async () => {
    const queue = typed.current;
    if (queue.sending || queue.pending.length === 0) return;
    const data = queue.pending;
    queue.pending = "";
    queue.sending = true;
    await writeShell({ environmentId, input: { ...target, data } });
    queue.sending = false;
    void sendTyped();
  };

  // The surface captures its callbacks once at creation.
  const onData = useStableCallback((data: string) => {
    typed.current.pending += data;
    void sendTyped();
  });
  const onResize = useStableCallback((cols: number, rows: number) => {
    const first = size.current === null;
    size.current = { cols, rows };
    if (first) void start(cols, rows);
    else if (shell.status === "running")
      void resizeShell({ environmentId, input: { ...target, cols, rows } });
  });

  // oxlint-disable-next-line aprende/no-unreasoned-state-sync -- writes new shell output into the imperative Ghostty terminal surface
  useEffect(() => {
    if (!surface || !view) return;
    const update = practiceTerminalUpdate(shown.current, view);
    if (update.reset) surface.resetAndWrite(update.data);
    else if (update.data.length > 0) surface.write(update.data);
    shown.current = view;
  }, [surface, view]);

  // oxlint-disable-next-line aprende/no-unreasoned-state-sync -- pauses the imperative surface's rendering while its tab is hidden
  useEffect(() => {
    surface?.setVisible(props.visible);
  }, [surface, props.visible]);

  const mountSurface = (element: HTMLDivElement) => {
    let disposed = false;
    let created: GhosttyTerminalSurface | null = null;
    void GhosttyTerminalSurface.create(element, {
      theme: terminalThemeFromApp(element),
      font: { size: 13 },
      onData,
      onResize,
      onSelectionChange: () => {},
      beforeKey: () => true,
      onLinkActivate: (url) => {
        if (/^https?:\/\//i.test(url))
          void ensureLocalApi()
            .shell.openExternal(url)
            .catch(() => setError("Could not open the link."));
      },
    })
      .then((terminalSurface) => {
        if (disposed) {
          terminalSurface.dispose();
          return;
        }
        created = terminalSurface;
        shown.current = EMPTY_PRACTICE_TERMINAL;
        setSurface(terminalSurface);
        terminalSurface.focus();
      })
      .catch(() => setError("Could not load the terminal. Close this tab and open it again."));
    return () => {
      disposed = true;
      created?.dispose();
      setSurface(null);
    };
  };

  const ended = shell.status === "running" ? (view?.ended ?? null) : null;
  const restart = () => {
    if (size.current !== null) void start(size.current.cols, size.current.rows);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-muted-foreground text-xs">
        <span className="min-w-0 flex-1 truncate">
          {terminal.folder} · runs on your computer with your permissions
        </span>
        {ended !== null || error !== null ? (
          <Button size="xs" variant="outline" onClick={restart}>
            {error !== null ? "Try again" : "Start a new shell"}
          </Button>
        ) : null}
      </div>
      {error !== null ? (
        <p role="alert" className="px-3 py-1.5 text-destructive text-sm">
          {error}
        </p>
      ) : ended !== null ? (
        <p role="status" className="px-3 py-1.5 text-muted-foreground text-sm">
          {ended.exitCode === null
            ? "This terminal is closed."
            : `The shell exited with code ${ended.exitCode}.`}
        </p>
      ) : output.error !== null ? (
        <p role="alert" className="px-3 py-1.5 text-destructive text-sm">
          {output.error}
        </p>
      ) : null}
      <div
        ref={mountSurface}
        aria-label={`Terminal in ${terminal.folder}`}
        className="relative min-h-0 flex-1 overflow-hidden"
      />
    </div>
  );
}
