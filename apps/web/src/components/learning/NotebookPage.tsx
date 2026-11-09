import { scopeProjectRef } from "@aprende/client-runtime/environment";
import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import {
  isListedThreadLineage,
  type EnvironmentId,
  type LearningNotebook,
  type LearningOutlineOp,
  type LearningOutlineTopic,
  type ProjectId,
} from "@aprende/contracts";
import { Link } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  EllipsisIcon,
  ListTreeIcon,
  SquarePenIcon,
} from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProject, useThreadShells } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  TOPIC_PROGRESS_LABEL,
  buildLessonMessage,
  neighborPlacement,
  nextTopic,
  topicProgress,
  type TopicProgress,
} from "./notebook.logic";
import { OutlineProposalCard } from "./OutlineProposalCard";
import { reportNotebookResult, useNotebook } from "./useNotebook";
import { useStartSession } from "./useStartSession";

const PROGRESS_ICON: Record<TopicProgress, typeof CircleIcon> = {
  todo: CircleIcon,
  inProgress: CircleDotIcon,
  learned: CircleCheckIcon,
  known: CircleDashedIcon,
};

const PROGRESS_ICON_CLASS: Record<TopicProgress, string> = {
  todo: "text-muted-foreground",
  inProgress: "text-info",
  learned: "text-success",
  known: "text-muted-foreground",
};

const NO_TOPIC = "none";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function NotebookPage(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const project = useProject(scopeProjectRef(props.environmentId, props.projectId));
  const notebook = useNotebook(props.environmentId, props.projectId);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          {project !== null ? <ProjectFavicon project={project} className="size-4" /> : null}
          <span className="truncate text-sm font-medium text-foreground">
            {project?.title ?? "Notebook"}
          </span>
        </WorkspacePageHeader>
        {project?.isScratch ? (
          <p className="px-6 py-4 text-muted-foreground text-sm">
            Sessions without a project are not in a notebook. Turn one into a project to give it an
            outline.
          </p>
        ) : project !== null && notebook !== null ? (
          <NotebookBody project={project} notebook={notebook} />
        ) : (
          <p className="px-6 py-4 text-muted-foreground text-sm">
            {project === null ? "This notebook is not on this machine." : "Loading…"}
          </p>
        )}
      </div>
    </SidebarInset>
  );
}

function NotebookBody(props: {
  readonly project: EnvironmentProject;
  readonly notebook: LearningNotebook;
}) {
  const { project, notebook } = props;
  const { topics } = notebook.outline;
  const environmentId = project.environmentId;
  const handleNewThread = useNewThreadHandler();
  const startSession = useStartSession();
  const editOutline = useAtomCommand(serverEnvironment.editOutline, {
    label: "change your outline",
    reportFailure: false,
  });
  const setLessonTopic = useAtomCommand(serverEnvironment.setLessonTopic, {
    label: "file the lesson under a topic",
    reportFailure: false,
  });
  const [starting, setStarting] = useState(false);

  const lessons = useThreadShells()
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.projectId === project.id &&
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        isListedThreadLineage(thread.lineage),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const topicOfLesson = new Map(
    notebook.lessons.map((lesson) => [lesson.threadId, lesson.topicId]),
  );
  const lessonsOf = (topicId: string) =>
    lessons.filter((thread) => topicOfLesson.get(thread.id) === topicId);
  const topicIds = new Set(topics.map((topic) => topic.id));
  const looseLessons = lessons.filter(
    (thread) => !topicIds.has(topicOfLesson.get(thread.id) ?? ""),
  );
  // Only lessons that exist count, so a start that failed leaves no topic in progress.
  const startedTopicIds = new Set(
    lessons.flatMap((thread) => {
      const topicId = topicOfLesson.get(thread.id);
      return topicId === undefined ? [] : [topicId];
    }),
  );

  const edit = async (ops: ReadonlyArray<LearningOutlineOp>) => {
    const result = await editOutline({ environmentId, input: { projectId: project.id, ops } });
    return reportNotebookResult(result, "Could not change your outline");
  };

  const startLesson = async (topic: LearningOutlineTopic) => {
    setStarting(true);
    await startSession(project, {
      title: topic.title,
      text: buildLessonMessage(topic, project.title),
      failureTitle: "Could not start the lesson",
      // Linked first, so the tutor's first turn already knows its topic.
      beforeStart: async (threadId) =>
        reportNotebookResult(
          await setLessonTopic({
            environmentId,
            input: { projectId: project.id, threadId, topicId: topic.id },
          }),
          "Could not start the lesson",
        ),
    });
    setStarting(false);
  };

  const removeTopic = async (topic: LearningOutlineTopic) => {
    const confirmed =
      (await requestConfirmDialog(
        `Remove “${topic.title}” from the outline?\nIts lessons stay in this notebook.`,
      )) ?? true;
    if (confirmed) await edit([{ type: "remove", topicId: topic.id }]);
  };

  const relink = async (thread: EnvironmentThreadShell, topicId: string | null) =>
    reportNotebookResult(
      await setLessonTopic({
        environmentId,
        input: { projectId: project.id, threadId: thread.id, topicId },
      }),
      "Could not move the lesson",
    );
  const lessonProps = {
    topics,
    topicOfLesson,
    onRelink: (thread: EnvironmentThreadShell, topicId: string | null) =>
      void relink(thread, topicId),
  };

  const next = nextTopic(topics, startedTopicIds);
  const nextLessons = next === undefined ? [] : lessonsOf(next.id);
  const counts = {
    learned: topics.filter((topic) => topic.status === "learned").length,
    known: topics.filter((topic) => topic.status === "known").length,
  };
  const remaining = topics.length - counts.learned - counts.known;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <span className="min-w-0 flex-1 text-muted-foreground text-sm">
          {topics.length === 0
            ? "No outline yet"
            : [
                `${counts.learned} learned`,
                ...(counts.known > 0 ? [`${counts.known} known`] : []),
                `${remaining} to go`,
              ].join(" · ")}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleNewThread(scopeProjectRef(environmentId, project.id))}
        >
          New lesson
        </Button>
        {next !== undefined ? (
          nextLessons[0] !== undefined ? (
            <Button
              size="sm"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: nextLessons[0].id }}
                />
              }
            >
              Continue: {next.title}
            </Button>
          ) : (
            <Button size="sm" disabled={starting} onClick={() => void startLesson(next)}>
              {starting ? "Starting…" : `Start: ${next.title}`}
            </Button>
          )
        ) : null}
      </div>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
          {notebook.proposal !== null ? (
            <OutlineProposalCard proposal={notebook.proposal} environmentId={environmentId} />
          ) : null}
          {topics.length === 0 ? (
            <Empty size="compact">
              <EmptyHeader>
                <EmptyTitle>No outline yet</EmptyTitle>
                <EmptyDescription>
                  Start a lesson and the tutor suggests an outline for this subject once it knows
                  where you are. Or add topics yourself.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ol className="flex flex-col divide-y divide-border" aria-label="Outline">
              {topics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  environmentId={environmentId}
                  topic={topic}
                  progress={topicProgress(topic, startedTopicIds)}
                  lessons={lessonsOf(topic.id)}
                  lessonProps={lessonProps}
                  canMoveUp={neighborPlacement(topics, topic.id, "up") !== undefined}
                  canMoveDown={neighborPlacement(topics, topic.id, "down") !== undefined}
                  starting={starting}
                  onStart={() => void startLesson(topic)}
                  onEdit={edit}
                  onMove={(direction) => {
                    const after = neighborPlacement(topics, topic.id, direction);
                    if (after !== undefined)
                      void edit([{ type: "move", topicId: topic.id, after }]);
                  }}
                  onRemove={() => void removeTopic(topic)}
                />
              ))}
            </ol>
          )}
          <AddTopic onAdd={(title) => edit([{ type: "add", title }])} />
          {looseLessons.length > 0 ? (
            <section aria-label="Other lessons" className="flex flex-col gap-1.5 pt-2">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Other lessons
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {looseLessons.map((thread) => (
                  <LessonLink key={thread.id} thread={thread} {...lessonProps} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TopicRow(props: {
  readonly environmentId: EnvironmentId;
  readonly topic: LearningOutlineTopic;
  readonly progress: TopicProgress;
  readonly lessons: ReadonlyArray<EnvironmentThreadShell>;
  readonly lessonProps: LessonTopicProps;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly starting: boolean;
  readonly onStart: () => void;
  readonly onEdit: (ops: ReadonlyArray<LearningOutlineOp>) => Promise<boolean>;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onRemove: () => void;
}) {
  const { topic } = props;
  const [renaming, setRenaming] = useState(false);
  const Icon = PROGRESS_ICON[props.progress];
  const markAs = (status: LearningOutlineTopic["status"]) =>
    void props.onEdit([{ type: "setStatus", topicId: topic.id, status }]);

  return (
    <li className="flex gap-3 py-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="mt-0.5 shrink-0" aria-label={TOPIC_PROGRESS_LABEL[props.progress]} />
          }
        >
          <Icon aria-hidden className={`size-4 ${PROGRESS_ICON_CLASS[props.progress]}`} />
        </TooltipTrigger>
        <TooltipPopup side="top">{TOPIC_PROGRESS_LABEL[props.progress]}</TooltipPopup>
      </Tooltip>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        {renaming ? (
          <TopicTitleInput
            initial={topic.title}
            onDone={async (title) => {
              if (title !== null && title !== topic.title)
                await props.onEdit([{ type: "rename", topicId: topic.id, title }]);
              setRenaming(false);
            }}
          />
        ) : (
          <span className="font-medium text-foreground">{topic.title}</span>
        )}
        {topic.summary ? <p className="text-muted-foreground">{topic.summary}</p> : null}
        {topic.status === "known" ? (
          <p className="text-muted-foreground text-xs">Known, not checked by a lesson yet</p>
        ) : null}
        {props.lessons.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-xs">
            {props.lessons.map((thread) => (
              <LessonLink key={thread.id} thread={thread} {...props.lessonProps} />
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <Button size="xs" variant="outline" disabled={props.starting} onClick={props.onStart}>
          Start lesson
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button aria-label={`More for ${topic.title}`} size="icon-xs" variant="ghost-muted" />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => setRenaming(true)}>Rename</MenuItem>
            <MenuItem disabled={!props.canMoveUp} onClick={() => props.onMove("up")}>
              Move up
            </MenuItem>
            <MenuItem disabled={!props.canMoveDown} onClick={() => props.onMove("down")}>
              Move down
            </MenuItem>
            <MenuSeparator />
            {topic.status === "known" || topic.status === "learned" ? (
              <MenuItem onClick={() => markAs("todo")}>Mark as to do</MenuItem>
            ) : (
              <MenuItem onClick={() => markAs("known")}>I already know this</MenuItem>
            )}
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onRemove}>
              Remove from outline
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </li>
  );
}

function TopicTitleInput(props: {
  readonly initial: string;
  readonly onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(props.initial);
  const finish = (save: boolean) => props.onDone(save && value.trim() ? value.trim() : null);
  return (
    <Input
      autoFocus
      aria-label="Topic title"
      size="sm"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
    />
  );
}

function AddTopic(props: { readonly onAdd: (title: string) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim() || saving) return;
        setSaving(true);
        if (await props.onAdd(title.trim())) setTitle("");
        setSaving(false);
      }}
    >
      <Input
        aria-label="New topic"
        className="flex-1"
        placeholder="Add a topic"
        size="sm"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button size="sm" type="submit" variant="outline" disabled={!title.trim() || saving}>
        Add
      </Button>
    </form>
  );
}

interface LessonTopicProps {
  readonly topics: ReadonlyArray<LearningOutlineTopic>;
  readonly topicOfLesson: ReadonlyMap<string, string>;
  readonly onRelink: (thread: EnvironmentThreadShell, topicId: string | null) => void;
}

function LessonLink(props: LessonTopicProps & { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const linked = props.topicOfLesson.get(thread.id);
  const value =
    linked !== undefined && props.topics.some((topic) => topic.id === linked) ? linked : NO_TOPIC;
  return (
    <li className="group/lesson flex min-w-0 items-center gap-2 text-muted-foreground">
      <SquarePenIcon aria-hidden className="size-3 shrink-0" />
      <Link
        className="min-w-0 truncate text-foreground underline-offset-2 hover:underline"
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
      >
        {thread.title}
      </Link>
      <span className="shrink-0 tabular-nums">{shortDate(thread.createdAt)}</span>
      {props.topics.length > 0 ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={`Topic for ${thread.title}`}
                size="icon-xs"
                variant="ghost-muted"
              />
            }
          >
            <ListTreeIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuRadioGroup
              value={value}
              onValueChange={(next) => {
                if (typeof next === "string" && next !== value)
                  props.onRelink(thread, next === NO_TOPIC ? null : next);
              }}
            >
              <MenuGroupLabel>Lesson topic</MenuGroupLabel>
              {props.topics.map((topic) => (
                <MenuRadioItem key={topic.id} value={topic.id}>
                  {topic.title}
                </MenuRadioItem>
              ))}
              <MenuRadioItem value={NO_TOPIC}>No topic</MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      ) : null}
    </li>
  );
}
