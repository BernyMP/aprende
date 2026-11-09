import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import {
  isListedThreadLineage,
  type LearningLessonTopic,
  type LearningOutlineOp,
  type LearningOutlineTopic,
  type LearningTopicStatus,
} from "@aprende/contracts";

/** What a topic row shows: a to-do topic with lessons is in progress. */
export type TopicProgress = LearningTopicStatus | "inProgress";

export const TOPIC_PROGRESS_LABEL: Record<TopicProgress, string> = {
  todo: "To do",
  inProgress: "In progress",
  learned: "Learned",
  known: "Known, not checked",
};

const STATUS_LABEL: Record<LearningTopicStatus, string> = {
  todo: "to do",
  learned: "learned",
  known: "known",
};

export function topicProgress(
  topic: LearningOutlineTopic,
  startedTopicIds: ReadonlySet<string>,
): TopicProgress {
  return topic.status === "todo" && startedTopicIds.has(topic.id) ? "inProgress" : topic.status;
}

const quoted = (titles: ReadonlyMap<string, string>, id: string) => {
  const title = titles.get(id);
  return title === undefined ? "a topic that is gone" : `“${title}”`;
};

const placement = (
  titles: ReadonlyMap<string, string>,
  after: string | null | undefined,
  preposition: "at" | "to",
) =>
  after === undefined
    ? `${preposition} the end`
    : after === null
      ? `${preposition} the start`
      : `after ${quoted(titles, after)}`;

/** One line the learner reads for a suggested outline change. */
export function describeOutlineOp(
  op: LearningOutlineOp,
  titles: ReadonlyMap<string, string>,
): string {
  switch (op.type) {
    case "add":
      return `Add “${op.title}” ${placement(titles, op.after, "at")}`;
    case "rename":
      return `Rename ${quoted(titles, op.topicId)} to “${op.title}”`;
    case "move":
      return `Move ${quoted(titles, op.topicId)} ${placement(titles, op.after, "to")}`;
    case "remove":
      return `Remove ${quoted(titles, op.topicId)}`;
    case "setStatus":
      return `Mark ${quoted(titles, op.topicId)} as ${STATUS_LABEL[op.status]}`;
  }
}

/** The topic to study next: the first one in progress, else the first one not started. */
export function nextTopic(
  topics: ReadonlyArray<LearningOutlineTopic>,
  startedTopicIds: ReadonlySet<string>,
): LearningOutlineTopic | undefined {
  const todo = topics.filter((topic) => topic.status === "todo");
  return todo.find((topic) => startedTopicIds.has(topic.id)) ?? todo[0];
}

export function buildLessonMessage(topic: LearningOutlineTopic, notebook: string): string {
  const lines = [`I want to learn “${topic.title}” next, in my ${notebook} notebook.`];
  if (topic.summary) lines.push("", topic.summary);
  return lines.join("\n");
}

/** Where `topicId` lands when it moves one place up or down, as a `move` op's `after`. */
export function neighborPlacement(
  topics: ReadonlyArray<LearningOutlineTopic>,
  topicId: string,
  direction: "up" | "down",
): string | null | undefined {
  const index = topics.findIndex((topic) => topic.id === topicId);
  if (index === -1) return undefined;
  if (direction === "up") {
    if (index === 0) return undefined;
    return index === 1 ? null : topics[index - 2]!.id;
  }
  return index === topics.length - 1 ? undefined : topics[index + 1]!.id;
}

/**
 * A notebook's lessons: its listed, unarchived threads, newest first, with their topic links.
 * Only lessons that exist count as started, so a start that failed leaves no topic in progress.
 */
export function notebookLessons(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  notebook: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly links: ReadonlyArray<LearningLessonTopic>;
  },
) {
  const lessons = threads
    .filter(
      (thread) =>
        thread.environmentId === notebook.environmentId &&
        thread.projectId === notebook.projectId &&
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        isListedThreadLineage(thread.lineage),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const topicOfLesson: ReadonlyMap<string, string> = new Map(
    notebook.links.map((link) => [link.threadId, link.topicId]),
  );
  const startedTopicIds: ReadonlySet<string> = new Set(
    lessons.flatMap((thread) => {
      const topicId = topicOfLesson.get(thread.id);
      return topicId === undefined ? [] : [topicId];
    }),
  );
  return { lessons, topicOfLesson, startedTopicIds };
}
