import type { LearningPlan } from "@aprende/contracts";

import { cn } from "~/lib/utils";

const NODE_WIDTH = 176;
const NODE_HEIGHT = 48;
const GAP_X = 20;
const GAP_Y = 36;

interface PlacedNode {
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
}

/** Layers by longest path from the foundations, so every edge points down the map. */
function layoutPlan(plan: Pick<LearningPlan, "nodes" | "edges">): {
  readonly nodes: ReadonlyArray<PlacedNode>;
  readonly width: number;
  readonly height: number;
} {
  const incoming = new Map<string, Array<string>>();
  for (const edge of plan.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    const parents = incoming.get(id) ?? [];
    const value =
      parents.length === 0
        ? 0
        : Math.max(...parents.map((parent) => depthOf(parent, new Set([...seen, id])))) + 1;
    depth.set(id, value);
    return value;
  };
  const layers: Array<Array<LearningPlan["nodes"][number]>> = [];
  for (const node of plan.nodes) {
    const layer = depthOf(node.id, new Set());
    (layers[layer] ??= []).push(node);
  }
  const widest = Math.max(1, ...layers.map((layer) => layer.length));
  const width = widest * NODE_WIDTH + (widest - 1) * GAP_X;
  const nodes = layers.flatMap((layer, layerIndex) => {
    const rowWidth = layer.length * NODE_WIDTH + (layer.length - 1) * GAP_X;
    const offset = (width - rowWidth) / 2;
    return layer.map((node, index) => ({
      id: node.id,
      title: node.title,
      x: offset + index * (NODE_WIDTH + GAP_X),
      y: layerIndex * (NODE_HEIGHT + GAP_Y),
    }));
  });
  return { nodes, width, height: layers.length * NODE_HEIGHT + (layers.length - 1) * GAP_Y };
}

export function PlanMap(props: {
  readonly plan: Pick<LearningPlan, "nodes" | "edges">;
  readonly currentNodeId: string | null;
  readonly visitedNodeIds: ReadonlySet<string>;
}) {
  const layout = layoutPlan(props.plan);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="Learning plan"
        width={layout.width}
        height={layout.height}
        viewBox={`-2 -2 ${layout.width + 4} ${layout.height + 4}`}
        className="mx-auto block max-w-none"
      >
        {props.plan.edges.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (from === undefined || to === undefined) return null;
          const x1 = from.x + NODE_WIDTH / 2;
          const y1 = from.y + NODE_HEIGHT;
          const x2 = to.x + NODE_WIDTH / 2;
          const y2 = to.y;
          const middle = (y1 + y2) / 2;
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`}
              fill="none"
              className="stroke-border"
              strokeWidth={1.5}
            />
          );
        })}
        {layout.nodes.map((node) => {
          const current = node.id === props.currentNodeId;
          const visited = !current && props.visitedNodeIds.has(node.id);
          return (
            <foreignObject
              key={node.id}
              x={node.x}
              y={node.y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
            >
              <div
                className={cn(
                  "flex size-full items-center justify-center rounded-lg border px-2 text-center text-xs leading-tight",
                  current
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : visited
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-border bg-card text-card-foreground",
                )}
              >
                <span className="line-clamp-2">{node.title}</span>
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
