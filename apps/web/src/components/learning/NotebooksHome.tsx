import { scopeProjectRef } from "@aprende/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import { NEW_NOTEBOOK_TITLE } from "@aprende/contracts";
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
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useNewNotebook } from "./useNewNotebook";
import { notebookLessons, notebookNextStep } from "./notebook.logic";
import { useNotebook } from "./useNotebook";
import { useStartLesson } from "./useStartLesson";

const NO_THREADS: ReadonlyArray<EnvironmentThreadShell> = [];
const SECTION_HEADING_CLASS = "font-medium text-muted-foreground text-xs uppercase tracking-wide";

const notebookKey = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;

/** Where aprende opens: how to start, the notebook studied last, then the rest. */
export function NotebooksHome(props: {
  /** Most recently studied first. */
  readonly notebooks: ReadonlyArray<EnvironmentProject>;
  readonly threadsByNotebook: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>;
}) {
  const contentArea = workspaceAreaProps("home", 1, "Home");
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const newNotebook = useNewNotebook();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  const threadsOf = (project: EnvironmentProject) =>
    props.threadsByNotebook.get(notebookKey(project)) ?? NO_THREADS;

  const [latest, ...older] = props.notebooks;
  // A notebook nobody has studied yet is not somewhere to pick up from.
  const recent = latest !== undefined && threadsOf(latest).length > 0 ? latest : undefined;
  const others = recent === undefined ? props.notebooks : older;

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
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
            <header className="flex flex-col items-center gap-2 text-center">
              <h1 className="font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
                What do you want to learn?
              </h1>
              <p className="max-w-md text-balance text-muted-foreground text-sm">
                Give each subject its own notebook. The tutor plans the topics with you and keeps
                track of what you have learned.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => void newNotebook()}>
                  <PlusIcon />
                  New notebook
                </Button>
                {scratchTargetEnvironmentId === null ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
                  >
                    <MessageSquareDashedIcon />
                    Ask a quick question
                  </Button>
                )}
              </div>
            </header>
            {recent === undefined ? null : (
              <section aria-labelledby="home-recent-heading" className="flex flex-col gap-2">
                <h2 id="home-recent-heading" className={SECTION_HEADING_CLASS}>
                  Pick up where you left off
                </h2>
                <ul className="grid">
                  <NotebookCard project={recent} threads={threadsOf(recent)} featured />
                </ul>
              </section>
            )}
            {others.length === 0 ? null : (
              <section aria-labelledby="home-notebooks-heading" className="flex flex-col gap-2">
                <h2 id="home-notebooks-heading" className={SECTION_HEADING_CLASS}>
                  {recent === undefined ? "Your notebooks" : "Your other notebooks"}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {others.map((project) => (
                    <NotebookCard
                      key={notebookKey(project)}
                      project={project}
                      threads={threadsOf(project)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function NotebookCard(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly featured?: boolean;
}) {
  const { project } = props;
  const notebook = useNotebook(project.environmentId, project.id);
  // Re-renders each minute so "2h ago" stays current.
  useNowMinute();
  const startLesson = useStartLesson();
  const handleNewThread = useNewThreadHandler();
  const [starting, setStarting] = useState(false);
  const notebookParams = { environmentId: project.environmentId, projectId: project.id };
  const actionSize = props.featured ? "sm" : "xs";
  // The tutor names a notebook in its first lesson; until then the placeholder would read like the button.
  const unnamed = project.title === NEW_NOTEBOOK_TITLE;

  const topics = notebook?.outline.topics ?? [];
  const lessonState = notebookLessons(props.threads, {
    environmentId: project.environmentId,
    projectId: project.id,
    links: notebook?.lessons ?? [],
  });
  const learned = topics.filter((topic) => topic.status === "learned").length;
  const known = topics.filter((topic) => topic.status === "known").length;
  const step = notebookNextStep({
    topics,
    hasProposal: notebook?.proposal != null,
    ...lessonState,
  });
  const lastStudied = lessonState.lessons
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
          {unnamed ? "Untitled notebook" : project.title}
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
          {topics.length === 0 ? null : (
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
                {learned} of {topics.length} topics learned
                {known > 0 ? ` · ${known} already known` : ""}
              </p>
            </div>
          )}
          {notebook.proposal !== null && topics.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              The tutor suggested a change to the topics.
            </p>
          ) : null}
          <div className="mt-auto flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {step.kind === "review"
                ? "The tutor suggested topics to study."
                : step.kind === "firstLesson"
                  ? "Start a lesson and the tutor plans the topics with you."
                  : step.kind === "done"
                    ? "Every topic is done."
                    : step.topic !== null
                      ? `Next: ${step.topic.title}`
                      : unnamed
                        ? "You and the tutor are still setting this up."
                        : "No topics yet. The tutor adds them as you learn."}
            </span>
            {step.kind === "review" ? (
              <Button
                size={actionSize}
                render={<Link to="/notebook/$environmentId/$projectId" params={notebookParams} />}
              >
                Review
              </Button>
            ) : step.kind === "firstLesson" ? (
              <Button
                size={actionSize}
                onClick={() =>
                  void handleNewThread(scopeProjectRef(project.environmentId, project.id))
                }
              >
                Start
              </Button>
            ) : step.kind === "done" ? (
              <Button
                size={actionSize}
                variant="outline"
                render={<Link to="/notebook/$environmentId/$projectId" params={notebookParams} />}
              >
                Open
              </Button>
            ) : step.kind === "resume" ? (
              <Button
                size={actionSize}
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId: project.environmentId, threadId: step.lesson.id }}
                  />
                }
              >
                {unnamed && step.topic === null ? "Continue setup" : "Continue"}
              </Button>
            ) : (
              <Button
                size={actionSize}
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  await startLesson(project, step.topic);
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
