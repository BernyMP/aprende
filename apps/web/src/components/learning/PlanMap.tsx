import type { LearningPlan } from "@aprende/contracts";
import { CheckIcon, CircleCheckIcon, CircleDotIcon, FlagIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { edgePath, layoutPlan, type PlacedNode } from "./PlanMap.logic";

type StepState = "done" | "current" | "todo";

const STEP_CLASS: Record<StepState, string> = {
  done: "border-success/40 bg-success/10 text-foreground",
  current: "border-info bg-info/10 font-medium text-foreground ring-3 ring-info/15",
  todo: "border-border bg-card text-card-foreground",
};

const STEP_LABEL: Record<StepState, string> = {
  done: "Done",
  current: "You are here",
  todo: "Ahead",
};

function Step(props: {
  readonly node: PlacedNode;
  readonly state: StepState;
  readonly compact: boolean;
}) {
  const { node, state, compact } = props;
  const box = { left: node.x, top: node.y, width: node.width, height: node.height };
  if (node.start) {
    return (
      <li
        style={box}
        className="absolute flex items-center justify-center gap-1.5 rounded-full border border-success/40 bg-success/10 font-medium text-foreground text-xs"
      >
        <CircleCheckIcon aria-hidden className="size-3.5 text-success" />
        Your starting point
      </li>
    );
  }
  const Icon = node.goal ? FlagIcon : state === "done" ? CheckIcon : CircleDotIcon;
  const step = (
    <li
      style={box}
      className={cn(
        "absolute flex items-center justify-center rounded-xl border leading-snug",
        compact ? "gap-1.5 px-2 text-xs" : "gap-2 px-3 text-sm",
        STEP_CLASS[state],
        node.goal && state === "todo" && "border-dashed border-foreground/30",
      )}
    >
      <span className="sr-only">
        {STEP_LABEL[state]}
        {node.goal ? ", your goal" : ""}:
      </span>
      {node.goal || state !== "todo" ? (
        <Icon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            state === "done"
              ? "text-success"
              : state === "current"
                ? "text-info"
                : "text-muted-foreground",
          )}
        />
      ) : null}
      <span
        className={cn(
          "min-w-0 text-balance text-center",
          compact ? "line-clamp-3" : "line-clamp-2",
        )}
      >
        {node.title}
      </span>
    </li>
  );
  return node.summary === undefined || node.summary.trim().length === 0 ? (
    step
  ) : (
    <Tooltip>
      <TooltipTrigger render={step} />
      <TooltipPopup side="right">{node.summary}</TooltipPopup>
    </Tooltip>
  );
}

export function PlanMap(props: {
  readonly plan: Pick<LearningPlan, "nodes" | "edges">;
  readonly currentNodeId: string | null;
  readonly visitedNodeIds: ReadonlySet<string>;
}) {
  const layout = layoutPlan(props.plan);
  const stateOf = (id: string): StepState =>
    id === props.currentNodeId ? "current" : props.visitedNodeIds.has(id) ? "done" : "todo";
  const walked = (node: PlacedNode | undefined) =>
    node !== undefined && (node.start || stateOf(node.id) === "done");
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  return (
    <div className="overflow-x-auto py-1">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        <svg
          aria-hidden
          className="absolute inset-0 overflow-visible"
          width={layout.width}
          height={layout.height}
        >
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edgePath(edge.points)}
              fill="none"
              strokeLinecap="round"
              strokeWidth={1.5}
              className={
                walked(byId.get(edge.from)) ? "stroke-success/60" : "stroke-muted-foreground/35"
              }
            />
          ))}
        </svg>
        <ul aria-label="Steps on your path">
          {layout.nodes.map((node) => (
            <Step key={node.id} node={node} state={stateOf(node.id)} compact={layout.compact} />
          ))}
        </ul>
      </div>
    </div>
  );
}
