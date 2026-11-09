import { describe, expect, it } from "vite-plus/test";

import { describeOutlineOp, neighborPlacement, nextTopic } from "./notebook.logic";

const topic = (id: string, status: "todo" | "learning" | "learned" | "known" = "todo") => ({
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
    expect(nextTopic([topic("a", "learned"), topic("b"), topic("c", "learning")])?.id).toBe("c");
    expect(nextTopic([topic("a", "known"), topic("b")])?.id).toBe("b");
    expect(nextTopic([topic("a", "learned")])).toBeUndefined();
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
