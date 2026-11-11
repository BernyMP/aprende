import { scopedThreadKey, scopeThreadRef } from "@aprende/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  LibraryIcon,
  MessageSquareDashedIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadActions } from "~/hooks/useThreadActions";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";

import { resolveSidebarFolderDot, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { SidebarProviderUpdatePill } from "../sidebar/SidebarProviderUpdatePill";
import { SidebarThreadUndoNotice } from "../sidebar/SidebarThreadUndoNotice";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function HeaderAction(props: {
  readonly label: string;
  readonly shortcut?: string | null;
  readonly render?: React.ReactElement;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost-muted"
            aria-label={props.label}
            {...(props.render ? { render: props.render } : {})}
            {...(props.onClick ? { onClick: props.onClick } : {})}
          />
        }
      >
        {props.children}
        <span className="max-md:hidden">{props.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {props.label}
        {props.shortcut ? ` (${props.shortcut})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The lesson list's sidebar already holds what the home page would otherwise offer. */
const useHasSidebar = () => useClientSettings((settings) => settings.sidebarLessonListEnabled);

/** Search and the app's other pages. The home page is where a learner finds them. */
export function HomeHeaderActions() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  if (useHasSidebar()) return null;
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <HeaderAction
        label="Search"
        shortcut={shortcutLabelForCommand(keybindings, "commandPalette.toggle")}
        onClick={() => openCommandPalette()}
      >
        <SearchIcon />
      </HeaderAction>
      <HeaderAction
        label="Knowledge"
        shortcut={shortcutLabelForCommand(keybindings, "knowledge.open")}
        render={<Link to="/knowledge" />}
      >
        <LibraryIcon />
      </HeaderAction>
      <HeaderAction label="Usage" render={<Link to="/usage" />}>
        <ChartNoAxesColumnIcon />
      </HeaderAction>
      <HeaderAction label="Settings" render={<Link to="/settings" />}>
        <SettingsIcon />
      </HeaderAction>
    </div>
  );
}

/** Undo for the last change and app updates: quiet until there is something to say. */
export function HomeStatusBar() {
  if (useHasSidebar()) return null;
  return (
    <footer className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-4 sm:px-6 [&:has(li,button,[role=alert])]:pb-3">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <ul className="flex min-w-0 items-center gap-1">
        <SidebarThreadUndoNotice />
        <SidebarUpdatePill />
      </ul>
    </footer>
  );
}

type QuestionState = NonNullable<ReturnType<typeof resolveSidebarFolderDot>>;

const QUESTION_STATE: Record<
  QuestionState,
  { readonly label: string; readonly dotClassName: string }
> = {
  attention: { label: "Waiting for your answer", dotClassName: "bg-warning" },
  failed: { label: "The tutor hit a problem", dotClassName: "bg-error" },
  unread: { label: "The tutor replied", dotClassName: "bg-success" },
  working: { label: "The tutor is working", dotClassName: "bg-info" },
};

function QuickQuestionRow(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const { settleThread } = useThreadActions();
  const localLastVisitedAt = useUiStateStore(
    (state) =>
      state.threadLastVisitedAtById[
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
      ],
  );
  const state = resolveSidebarFolderDot([
    {
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
    },
  ]);
  return (
    <li className="flex min-w-0 items-center gap-3 px-4 py-2.5">
      <MessageSquareDashedIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <Link
        className="min-w-0 flex-1 truncate font-medium text-foreground underline-offset-2 hover:underline"
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
      >
        {thread.title}
      </Link>
      {state === null ? null : (
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs max-sm:hidden">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", QUESTION_STATE[state].dotClassName)}
          />
          {QUESTION_STATE[state].label}
        </span>
      )}
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.createdAt)}
      </span>
      <Button
        size="xs"
        variant="ghost-muted"
        aria-label={`Done with ${thread.title}`}
        onClick={() => void settleThread(scopeThreadRef(thread.environmentId, thread.id))}
      >
        Done
      </Button>
    </li>
  );
}

/** The quick questions still in use. They leave on their own, so there is no list to tidy. */
export function HomeQuickQuestions(props: {
  readonly questions: ReadonlyArray<EnvironmentThreadShell>;
  readonly headingClassName: string;
}) {
  // Re-renders each minute so "2h ago" stays current.
  useNowMinute();
  if (props.questions.length === 0) return null;
  return (
    <section aria-labelledby="home-quick-questions-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="home-quick-questions-heading" className={props.headingClassName}>
          Quick questions
        </h2>
        <p className="text-muted-foreground text-xs">
          A question leaves this list a day after you last used it.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-xl border bg-card text-card-foreground text-sm">
        {props.questions.map((thread) => (
          <QuickQuestionRow
            key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
            thread={thread}
          />
        ))}
      </ul>
    </section>
  );
}
