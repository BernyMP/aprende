import { use } from "react";

import { TimelineRowCtx, type TimelineRow } from "../chat/timelineRowContext";
import { AssessmentCard } from "./AssessmentCard";
import { OutlineProposalCard } from "./OutlineProposalCard";
import { PlanMap } from "./PlanMap";
import { ProblemCard } from "./ProblemCard";
import { QuestionCard } from "./QuestionCard";
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
      <div className="min-w-0 px-1">
        <AssessmentCard assessment={state.assessment} />
      </div>
    ) : null;
  }

  if (!row.latest || state.plan === null) {
    return <p className="px-1 text-muted-foreground text-sm">The plan changed.</p>;
  }
  const visited = new Set(
    state.questions.flatMap((question) =>
      question.planNodeId !== null && question.status === "answered" ? [question.planNodeId] : [],
    ),
  );
  return (
    <section className="min-w-0 rounded-xl border bg-card px-4 py-3.5" aria-label="Your plan">
      <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Your path to the goal
      </p>
      <PlanMap plan={state.plan} currentNodeId={state.currentNodeId} visitedNodeIds={visited} />
    </section>
  );
}
