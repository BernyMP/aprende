import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@aprende/client-runtime/state/models";
import { ThreadId } from "@aprende/contracts";

import { describeOutlineOp, neighborPlacement, nextTopic, notebookLessons } from "./notebook.logic";

const topic = (id: string, status: "todo" | "learned" | "known" = "todo") => ({
  id,
  title: id.toUpperCase(),
  status,
});

describe("neighborPlacement", () => {
  const topics = [topic("a"), topic("b"), topic("c")];
  it.each([
    ["a", "up", undefined],
    ["b", "up", null],
    ["c", "up", "a"],
    ["a", "down", "b"],
    ["c", "down", undefined],
    ["gone", "down", undefined],
  ] as const)("moves %s %s after %s", (id, direction, after) => {
    expect(neighborPlacement(topics, id, direction)).toBe(after);
  });
});

describe("nextTopic", () => {
  it("continues the topic in progress before starting a new one", () => {
    const started = new Set(["c", "a"]);
    expect(nextTopic([topic("a", "learned"), topic("b"), topic("c")], started)?.id).toBe("c");
    expect(nextTopic([topic("a", "known"), topic("b")], started)?.id).toBe("b");
    expect(nextTopic([topic("a", "learned")], started)).toBeUndefined();
  });
});

describe("describeOutlineOp", () => {
  it("names topics by title, and a topic that is gone as such", () => {
    const titles = new Map([["a", "Vectors"]]);
    expect(describeOutlineOp({ type: "add", title: "Spans", after: "a" }, titles)).toBe(
      "Add “Spans” after “Vectors”",
    );
    expect(describeOutlineOp({ type: "move", topicId: "x", after: null }, titles)).toBe(
      "Move a topic that is gone to the start",
    );
  });
});

describe("notebookLessons", () => {
  const thread = (id: string, overrides: Partial<EnvironmentThreadShell> = {}) =>
    ({
      environmentId: "env",
      id: ThreadId.make(id),
      projectId: "notebook",
      archivedAt: null,
      deletedAt: null,
      lineage: { relationshipToParent: null, sideChat: false },
      createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
      ...overrides,
    }) as unknown as EnvironmentThreadShell;

  it("counts only listed lessons in this notebook that exist, newest first", () => {
    const { lessons, startedTopicIds } = notebookLessons(
      [
        thread("a"),
        thread("bb"),
        thread("side", { lineage: { relationshipToParent: null, sideChat: true } as never }),
        thread("elsewhere", { projectId: "other" as never }),
        thread("old", { archivedAt: "2026-01-02T00:00:00.000Z" }),
      ],
      {
        environmentId: "env",
        projectId: "notebook",
        links: [
          { threadId: ThreadId.make("a"), topicId: "t-1" },
          { threadId: ThreadId.make("side"), topicId: "t-2" },
          { threadId: ThreadId.make("never-started"), topicId: "t-3" },
        ],
      },
    );
    expect(lessons.map((entry) => entry.id)).toEqual(["bb", "a"]);
    expect([...startedTopicIds]).toEqual(["t-1"]);
  });
});
