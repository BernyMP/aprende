import { scopedThreadKey, scopeThreadRef } from "@aprende/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aprende/client-runtime/state/runtime";
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
import { useServerConfigs } from "~/state/entities";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";

import { resolveSidebarFolderDot, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { SidebarProviderUpdatePill } from "../sidebar/SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
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

/** App and provider updates, which the sidebar footer used to hold. */
export function HomeStatusBar() {
  if (useHasSidebar()) return null;
  return (
    <footer className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-4 sm:px-6 [&:has(li,button,[role=alert])]:pb-3">
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      <ul className="flex min-w-0 items-center gap-1">
        <SidebarUpdatePill />
      </ul>
    </footer>
  );
}

type TutorState = NonNullable<ReturnType<typeof resolveSidebarFolderDot>>;

const TUTOR_STATE: Record<TutorState, { readonly label: string; readonly dotClassName: string }> = {
  attention: { label: "Waiting for your answer", dotClassName: "bg-warning" },
  failed: { label: "The tutor hit a problem", dotClassName: "bg-error" },
  unread: { label: "The tutor replied", dotClassName: "bg-success" },
  working: { label: "The tutor is working", dotClassName: "bg-info" },
};

/**
 * What the tutor is doing in these lessons, for a learner who is not looking at them: the most
 * urgent state among them, or nothing when none needs a look.
 */
export function TutorStateLabel(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly className?: string;
}) {
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const state = resolveSidebarFolderDot(
    props.threads.map((thread) => ({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    })),
  );
  if (state === null) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs",
        props.className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TUTOR_STATE[state].dotClassName)} />
      {TUTOR_STATE[state].label}
    </span>
  );
}

function QuickQuestionRow(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const { settleThread } = useThreadActions();
  // Re-renders each minute so "2h ago" stays current.
  useNowMinute();
  const finish = async () => {
    const result = await settleThread(scopeThreadRef(thread.environmentId, thread.id), {
      notice: "Done",
    });
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Could not put the question away",
      description: error instanceof Error ? error.message : "Something went wrong.",
    });
  };
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
      <TutorStateLabel threads={[thread]} className="max-sm:hidden" />
      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
        {formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.createdAt)}
      </span>
      <Button
        size="xs"
        variant="ghost-muted"
        aria-label={`Done with ${thread.title}`}
        onClick={() => void finish()}
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
  const serverConfigs = useServerConfigs();
  if (props.questions.length === 0) return null;
  // Only a server set to settle idle lessons puts idle questions away.
  const leaveOnTheirOwn = props.questions.some(
    (thread) =>
      serverConfigs.get(thread.environmentId)?.settings.sidebarAutoSettleAfterDays != null,
  );
  return (
    <section aria-labelledby="home-quick-questions-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="home-quick-questions-heading" className={props.headingClassName}>
          Quick questions
        </h2>
        {leaveOnTheirOwn ? (
          <p className="text-muted-foreground text-xs">
            A question leaves this list a day after you last used it.
          </p>
        ) : null}
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
