import { describe, expect, it } from "vite-plus/test";

import { layoutPlan, PLAN_START_ID } from "./PlanMap.logic";

const plan = (edges: ReadonlyArray<readonly [string, string]>) => ({
  nodes: [...new Set(edges.flat())].map((id) => ({ id, title: id })),
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe("layoutPlan", () => {
  it("routes an edge that skips layers beside the nodes it passes", () => {
    const layout = layoutPlan(
      plan([
        ["annotations", "objects"],
        ["annotations", "generics"],
        ["objects", "unions"],
        ["unions", "narrowing"],
        ["generics", "narrowing"],
        ["narrowing", "real"],
        ["generics", "real"],
      ]),
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const crossed = layout.edges.flatMap((edge) =>
      edge.points.flatMap((point) =>
        layout.nodes
          .filter(
            (node) =>
              node.id !== edge.from &&
              node.id !== edge.to &&
              point.x > node.x &&
              point.x < node.x + node.width &&
              point.y >= node.y &&
              point.y <= node.y + node.height,
          )
          .map((node) => `${edge.from}->${edge.to} over ${node.id}`),
      ),
    );
    expect(crossed).toEqual([]);
    // Two skipped layers, so two lanes, each entered and left.
    expect(
      layout.edges.find((edge) => edge.from === "generics" && edge.to === "real")?.points,
    ).toHaveLength(6);
    expect(layout.edges.every((edge) => byId.get(edge.from)!.y < byId.get(edge.to)!.y)).toBe(true);
    expect(layout.nodes.filter((node) => node.goal).map((node) => node.id)).toEqual(["real"]);
    expect(
      layout.edges.filter((edge) => edge.from === PLAN_START_ID).map((edge) => edge.to),
    ).toEqual(["annotations"]);
  });
});
