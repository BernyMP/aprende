import { use } from "react";

import { TimelineRowCtx, type TimelineRow } from "../chat/timelineRowContext";
import { OutlineProposalCard } from "./OutlineProposalCard";
import { PlanMap } from "./PlanMap";
import { ProblemCard } from "./ProblemCard";
import { QuestionCard } from "./QuestionCard";
import { StartingPoint } from "./StartingPoint";
import { useLearningThread } from "./useLearningThread";

export function LearningTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "learning" }> }) {
  const ctx = use(TimelineRowCtx);
  const state = useLearningThread(ctx.threadRef);
  if (state === null || ctx.threadRef === null) return null;

  if (row.tool === "pose_problem") {
    const problem = state.problems.find((entry) => entry.id === row.recordId);
    if (problem === undefined) return null;
    const send = ctx.onSendAppMessage;
    const canAskNext =
      send !== undefined &&
      problem.status === "concluded" &&
      state.problems.at(-1)?.id === problem.id &&
      !state.questions.some((question) => question.status === "open");
    return (
      <div className="min-w-0 px-1">
        <ProblemCard
          problem={problem}
          threadRef={ctx.threadRef}
          markdownCwd={ctx.markdownCwd}
          onNextProblem={canAskNext ? () => send("Next problem.") : undefined}
        />
      </div>
    );
  }

  if (row.tool === "ask_question") {
    const question = state.questions.find((entry) => entry.id === row.recordId);
    return question === undefined ? null : (
      <div className="min-w-0 px-1">
        <QuestionCard question={question} threadRef={ctx.threadRef} markdownCwd={ctx.markdownCwd} />
      </div>
    );
  }

  if (row.tool === "propose_outline") {
    const proposal = state.proposals.find((entry) => entry.id === row.recordId);
    return proposal === undefined ? null : (
      <div className="min-w-0 px-1">
        <OutlineProposalCard proposal={proposal} environmentId={ctx.threadRef.environmentId} />
      </div>
    );
  }

  if (row.tool === "finish_measuring") {
    return row.latest && state.assessment !== null ? (
      <div className="min-w-0 px-1 py-2">
        <StartingPoint assessment={state.assessment} />
      </div>
    ) : null;
  }

  if (!row.latest || state.plan === null) {
    return <p className="px-1 text-muted-foreground text-sm">The plan changed.</p>;
  }
  const { plan, currentNodeId } = state;
  const visited = new Set(
    state.questions.flatMap((question) =>
      question.planNodeId !== null && question.status === "answered" ? [question.planNodeId] : [],
    ),
  );
  const current = plan.nodes.find((node) => node.id === currentNodeId);
  const done = plan.nodes.filter((node) => node.id !== currentNodeId && visited.has(node.id));
  const steps = `${plan.nodes.length} ${plan.nodes.length === 1 ? "step" : "steps"}`;
  return (
    <section className="flex min-w-0 flex-col gap-3 px-1 py-2 text-sm" aria-label="Your path">
      <div className="flex flex-col gap-1.5">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Your path
        </p>
        <p className="text-pretty">
          {current === undefined ? (
            done.length === 0 ? (
              `${steps} from your starting point to your goal.`
            ) : (
              `${done.length} of ${steps} done.`
            )
          ) : (
            <>
              You are here: <span className="font-medium">{current.title}</span>
              <span className="text-muted-foreground">
                {" · "}
                {done.length} of {steps} done
              </span>
            </>
          )}
        </p>
      </div>
      <PlanMap plan={plan} currentNodeId={currentNodeId} visitedNodeIds={visited} />
    </section>
  );
}
