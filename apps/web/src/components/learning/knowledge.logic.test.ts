import { ProjectId, ThreadId } from "@aprende/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPracticeMessage, defaultPracticeProjectId } from "./knowledge.logic";

describe("buildPracticeMessage", () => {
  it("lists each proposition on one line by id, name and statement", () => {
    expect(
      buildPracticeMessage([
        { id: "p-1", name: "Edges", statement: "An edge points\nfrom prerequisite to dependent." },
        { id: "p-2", name: "Order", statement: "A valid order lists prerequisites first." },
      ]),
    ).toBe(
      [
        "Let's practice these propositions:",
        "",
        "- p-1: Edges: An edge points from prerequisite to dependent.",
        "- p-2: Order: A valid order lists prerequisites first.",
      ].join("\n"),
    );
  });
});

describe("defaultPracticeProjectId", () => {
  const session = (threadId: string, projectId: string, createdAt: string) => ({
    threadId: ThreadId.make(threadId),
    projectId: ProjectId.make(projectId),
    title: threadId,
    createdAt,
  });
  const sessions = [
    session("t-old", "maths", "2026-01-01T00:00:00.000Z"),
    session("t-new", "physics", "2026-03-01T00:00:00.000Z"),
    session("t-unrelated", "music", "2026-05-01T00:00:00.000Z"),
  ];

  it("picks the subject of the newest session that taught the selection", () => {
    expect(
      defaultPracticeProjectId(
        [
          { sourceThreadIds: [ThreadId.make("t-old")] },
          { sourceThreadIds: [ThreadId.make("t-new"), ThreadId.make("t-deleted")] },
        ],
        sessions,
      ),
    ).toBe("physics");
  });

  it("has no default when every source session is gone", () => {
    expect(
      defaultPracticeProjectId([{ sourceThreadIds: [ThreadId.make("t-deleted")] }], sessions),
    ).toBeNull();
  });
});
