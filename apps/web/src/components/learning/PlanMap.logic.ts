import type { LearningPlan } from "@aprende/contracts";

export const PLAN_START_ID = "plan-map:start";

/** The thread column's width. A wider map scrolls, so a wide plan gets narrower steps first. */
const FIT_WIDTH = 720;
const ROOMY = { width: 192, height: 52, gap: 20 };
const COMPACT = { minWidth: 124, height: 68, gap: 12 };
const START_WIDTH = 176;
const START_HEIGHT = 32;
/** The room an edge gets beside the nodes of a layer it skips. */
const LANE_WIDTH = 12;
const GAP_Y = 36;

export interface PlacedNode {
  readonly id: string;
  readonly title: string;
  readonly summary: string | undefined;
  /** The learner's starting point, drawn above the plan's first steps. */
  readonly start: boolean;
  /** The one step nothing builds on, so it is where the path leads. */
  readonly goal: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedEdge {
  readonly from: string;
  readonly to: string;
  /** From the bottom of `from` to the top of `to`, through the lanes of the layers it skips. */
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

type Slot =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "lane"; readonly edge: number; readonly at: number };

const slotKey = (slot: Slot) =>
  slot.kind === "node" ? `node:${slot.id}` : `lane:${slot.edge}@${slot.at}`;

/**
 * Layers by longest path from the starting point, so every edge points down the map. An edge
 * that skips a layer gets a lane in it, which keeps the line off the nodes it passes.
 */
export function layoutPlan(plan: Pick<LearningPlan, "nodes" | "edges">): {
  readonly nodes: ReadonlyArray<PlacedNode>;
  readonly edges: ReadonlyArray<PlacedEdge>;
  readonly width: number;
  readonly height: number;
  /** Steps were narrowed to fit, so they hold three short lines instead of two. */
  readonly compact: boolean;
} {
  const known = new Set(plan.nodes.map((node) => node.id));
  const planEdges = plan.edges.filter(
    (edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to,
  );
  const parents = new Map<string, Array<string>>();
  for (const edge of planEdges) parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);

  const layerOf = new Map<string, number>([[PLAN_START_ID, 0]]);
  const layer = (id: string, seen: ReadonlySet<string>): number => {
    const found = layerOf.get(id);
    if (found !== undefined) return found;
    if (seen.has(id)) return 1;
    const above = (parents.get(id) ?? []).map((parent) => layer(parent, new Set([...seen, id])));
    const value = Math.max(0, ...above) + 1;
    layerOf.set(id, value);
    return value;
  };
  for (const node of plan.nodes) layer(node.id, new Set());

  const edges = [
    ...plan.nodes
      .filter((node) => (parents.get(node.id) ?? []).length === 0)
      .map((node) => ({ from: PLAN_START_ID, to: node.id })),
    ...planEdges,
  ].filter((edge) => layerOf.get(edge.from)! < layerOf.get(edge.to)!);

  const layers: Array<Array<Slot>> = [[{ kind: "node", id: PLAN_START_ID }]];
  for (const node of plan.nodes)
    (layers[layerOf.get(node.id)!] ??= []).push({ kind: "node", id: node.id });
  /** What each slot hangs from in the layer above: a node, or the lane of its own edge. */
  const above = new Map<string, Array<string>>();
  const hang = (slot: Slot, from: Slot) =>
    above.set(slotKey(slot), [...(above.get(slotKey(slot)) ?? []), slotKey(from)]);
  edges.forEach((edge, index) => {
    let previous: Slot = { kind: "node", id: edge.from };
    for (let at = layerOf.get(edge.from)! + 1; at < layerOf.get(edge.to)!; at += 1) {
      const lane: Slot = { kind: "lane", edge: index, at };
      (layers[at] ??= []).push(lane);
      hang(lane, previous);
      previous = lane;
    }
    hang({ kind: "node", id: edge.to }, previous);
  });

  const steps = layers.slice(1);
  const lanesIn = (row: ReadonlyArray<Slot>) => row.filter((slot) => slot.kind === "lane").length;
  const fits = (stepWidth: number, gap: number) =>
    steps.every(
      (row) =>
        (row.length - lanesIn(row)) * stepWidth +
          lanesIn(row) * LANE_WIDTH +
          (row.length - 1) * gap <=
        FIT_WIDTH,
    );
  const compact = !fits(ROOMY.width, ROOMY.gap);
  const gap = compact ? COMPACT.gap : ROOMY.gap;
  const stepHeight = compact ? COMPACT.height : ROOMY.height;
  const widestThatFits = Math.min(
    ...steps.map((row) =>
      Math.floor(
        (FIT_WIDTH - lanesIn(row) * LANE_WIDTH - (row.length - 1) * gap) /
          Math.max(1, row.length - lanesIn(row)),
      ),
    ),
  );
  const stepWidth = compact
    ? Math.min(ROOMY.width, Math.max(COMPACT.minWidth, widestThatFits))
    : ROOMY.width;
  const widthOf = (slot: Slot) =>
    slot.kind === "lane" ? LANE_WIDTH : slot.id === PLAN_START_ID ? START_WIDTH : stepWidth;
  const rowWidth = (row: ReadonlyArray<Slot>) =>
    row.reduce((sum, slot) => sum + widthOf(slot), 0) + (row.length - 1) * gap;
  const width = Math.max(...layers.map(rowWidth));
  const topOf = (at: number) =>
    at === 0 ? 0 : START_HEIGHT + GAP_Y + (at - 1) * (stepHeight + GAP_Y);

  /** Each slot's centre. A row sits under what it hangs from, which keeps edges from crossing. */
  const centre = new Map<string, number>();
  const laneX = new Map<string, number>();
  const placed = new Map<string, Omit<PlacedNode, "id" | "title" | "summary" | "start" | "goal">>();
  layers.forEach((row, at) => {
    const pull = (slot: Slot) => {
      const anchors = (above.get(slotKey(slot)) ?? []).map((key) => centre.get(key) ?? width / 2);
      return anchors.length === 0
        ? width / 2
        : anchors.reduce((sum, value) => sum + value, 0) / anchors.length;
    };
    const ordered = row
      .map((slot, index) => ({ slot, index, pull: pull(slot) }))
      .toSorted((a, b) => a.pull - b.pull || a.index - b.index);
    let x = (width - rowWidth(row)) / 2;
    for (const { slot } of ordered) {
      const slotWidth = widthOf(slot);
      centre.set(slotKey(slot), x + slotWidth / 2);
      if (slot.kind === "lane") laneX.set(slotKey(slot), x + slotWidth / 2);
      else
        placed.set(slot.id, {
          x,
          y: topOf(at),
          width: slotWidth,
          height: at === 0 ? START_HEIGHT : stepHeight,
        });
      x += slotWidth + gap;
    }
  });

  const hasChild = new Set(planEdges.map((edge) => edge.from));
  const ends = plan.nodes.filter((node) => !hasChild.has(node.id));
  const box = (id: string) => placed.get(id)!;
  return {
    nodes: [
      {
        id: PLAN_START_ID,
        title: "",
        summary: undefined,
        start: true,
        goal: false,
        ...box(PLAN_START_ID),
      },
      ...plan.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        summary: node.summary,
        start: false,
        goal: ends.length === 1 && ends[0]!.id === node.id,
        ...box(node.id),
      })),
    ],
    edges: edges.map((edge, index) => {
      const from = box(edge.from);
      const to = box(edge.to);
      const through = [];
      for (let at = layerOf.get(edge.from)! + 1; at < layerOf.get(edge.to)!; at += 1)
        through.push({ x: laneX.get(slotKey({ kind: "lane", edge: index, at }))!, at });
      return {
        from: edge.from,
        to: edge.to,
        points: [
          { x: from.x + from.width / 2, y: from.y + from.height },
          ...through.flatMap((lane) => [
            { x: lane.x, y: topOf(lane.at) },
            { x: lane.x, y: topOf(lane.at) + stepHeight },
          ]),
          { x: to.x + to.width / 2, y: to.y },
        ],
      };
    }),
    width,
    height: topOf(layers.length - 1) + stepHeight,
    compact,
  };
}

/** A smooth line through an edge's points: curves between layers, straight down a lane. */
export function edgePath(points: PlacedEdge["points"]): string {
  return points
    .map((point, index) => {
      const previous = points[index - 1];
      if (previous === undefined) return `M ${point.x} ${point.y}`;
      if (previous.x === point.x) return `L ${point.x} ${point.y}`;
      const middle = (previous.y + point.y) / 2;
      return `C ${previous.x} ${middle}, ${point.x} ${middle}, ${point.x} ${point.y}`;
    })
    .join(" ");
}
