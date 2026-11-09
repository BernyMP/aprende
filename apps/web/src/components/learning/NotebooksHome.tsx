import { scopeProjectRef } from "@aprende/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import { Link } from "@tanstack/react-router";
import { MessageSquareDashedIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useScratchProject } from "~/hooks/useScratchProject";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useNewNotebook } from "./useNewNotebook";
import { nextTopic, notebookLessons } from "./notebook.logic";
import { useNotebook } from "./useNotebook";
import { useStartLesson } from "./useStartLesson";

const NO_THREADS: ReadonlyArray<EnvironmentThreadShell> = [];

/** Where aprende opens: every notebook with its progress and the topic to study next. */
export function NotebooksHome(props: {
  readonly notebooks: ReadonlyArray<EnvironmentProject>;
  readonly threadsByNotebook: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>;
}) {
  const contentArea = workspaceAreaProps("home", 1, "Home");
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const newNotebook = useNewNotebook();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="text-sm font-medium text-foreground">Notebooks</span>
        </WorkspacePageHeader>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
          <span className="min-w-0 basis-full text-muted-foreground text-sm sm:basis-0 sm:flex-1">
            Pick up where you left off, or start something new.
          </span>
          {scratchTargetEnvironmentId === null ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
            >
              <MessageSquareDashedIcon />
              Quick question
            </Button>
          )}
          <Button size="sm" onClick={() => void newNotebook()}>
            <PlusIcon />
            New notebook
          </Button>
        </div>
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          {props.notebooks.length === 0 ? (
            <Empty size="compact">
              <EmptyHeader>
                <EmptyTitle>No notebooks yet</EmptyTitle>
                <EmptyDescription>
                  A notebook holds one subject you are learning, with an outline that grows as you
                  go. Create one to start.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul
              aria-label="Notebooks"
              className="mx-auto grid max-w-4xl gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6"
            >
              {props.notebooks.map((project) => {
                const key = `${project.environmentId}:${project.id}`;
                return (
                  <NotebookCard
                    key={key}
                    project={project}
                    threads={props.threadsByNotebook.get(key) ?? NO_THREADS}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function NotebookCard(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const { project } = props;
  const notebook = useNotebook(project.environmentId, project.id);
  // Re-renders each minute so "2h ago" stays current.
  useNowMinute();
  const startLesson = useStartLesson();
  const handleNewThread = useNewThreadHandler();
  const [starting, setStarting] = useState(false);
  const notebookParams = { environmentId: project.environmentId, projectId: project.id };

  const topics = notebook?.outline.topics ?? [];
  const { lessons, topicOfLesson, startedTopicIds } = notebookLessons(props.threads, {
    environmentId: project.environmentId,
    projectId: project.id,
    links: notebook?.lessons ?? [],
  });
  const learned = topics.filter((topic) => topic.status === "learned").length;
  const known = topics.filter((topic) => topic.status === "known").length;
  const next = nextTopic(topics, startedTopicIds);
  const nextLesson =
    next === undefined
      ? undefined
      : lessons.find((thread) => topicOfLesson.get(thread.id) === next.id);
  const lastStudied = lessons
    .map((thread) => thread.latestUserMessageAt ?? thread.createdAt)
    .toSorted()
    .at(-1);

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card px-4 py-3.5 text-card-foreground text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <ProjectFavicon project={project} className="size-4 shrink-0" />
        <Link
          className="min-w-0 flex-1 truncate font-medium text-foreground underline-offset-2 hover:underline"
          to="/notebook/$environmentId/$projectId"
          params={notebookParams}
        >
          {project.title}
        </Link>
        {lastStudied === undefined ? null : (
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {formatRelativeTimeLabel(lastStudied)}
          </span>
        )}
      </div>
      {notebook === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {topics.length === 0 ? (
            <p className="text-muted-foreground">
              {lessons.length === 0
                ? "No lessons yet."
                : `${lessons.length === 1 ? "1 lesson" : `${lessons.length} lessons`}, no outline yet.`}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${learned} of ${topics.length} topics learned`}
                aria-valuemin={0}
                aria-valuemax={topics.length}
                aria-valuenow={learned}
              >
                <div
                  className="h-full rounded-full bg-success"
                  style={{ width: `${(learned / topics.length) * 100}%` }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {learned} of {topics.length} learned{known > 0 ? ` · ${known} known` : ""}
              </p>
            </div>
          )}
          {notebook.proposal !== null && topics.length > 0 ? (
            <p className="text-muted-foreground text-xs">The tutor suggested an outline change.</p>
          ) : null}
          <div className="mt-auto flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {topics.length === 0
                ? notebook.proposal !== null
                  ? "The tutor suggested an outline."
                  : "Start a lesson to get an outline."
                : next === undefined
                  ? "Every topic is done."
                  : `Next: ${next.title}`}
            </span>
            {topics.length === 0 && notebook.proposal !== null ? (
              <Button
                size="xs"
                render={<Link to="/notebook/$environmentId/$projectId" params={notebookParams} />}
              >
                Review
              </Button>
            ) : topics.length === 0 ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void handleNewThread(scopeProjectRef(project.environmentId, project.id))
                }
              >
                New lesson
              </Button>
            ) : next === undefined ? (
              <Button
                size="xs"
                variant="outline"
                render={<Link to="/notebook/$environmentId/$projectId" params={notebookParams} />}
              >
                Open
              </Button>
            ) : nextLesson !== undefined ? (
              <Button
                size="xs"
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId: project.environmentId, threadId: nextLesson.id }}
                  />
                }
              >
                Continue
              </Button>
            ) : (
              <Button
                size="xs"
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  await startLesson(project, next);
                  setStarting(false);
                }}
              >
                {starting ? "Starting…" : "Start"}
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  );
}
