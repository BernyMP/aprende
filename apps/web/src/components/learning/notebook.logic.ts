import type {
  LearningOutlineOp,
  LearningOutlineTopic,
  LearningTopicStatus,
} from "@aprende/contracts";

export const TOPIC_STATUS_LABEL: Record<LearningTopicStatus, string> = {
  todo: "To do",
  learning: "Learning",
  learned: "Learned",
  known: "Known, not checked",
};

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
      return `Mark ${quoted(titles, op.topicId)} as ${TOPIC_STATUS_LABEL[op.status].toLowerCase()}`;
  }
}

/** The topic to study next: the first one in progress, else the first one not started. */
export function nextTopic(
  topics: ReadonlyArray<LearningOutlineTopic>,
): LearningOutlineTopic | undefined {
  return (
    topics.find((topic) => topic.status === "learning") ??
    topics.find((topic) => topic.status === "todo")
  );
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
