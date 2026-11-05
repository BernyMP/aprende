import { use } from "react";

import { TimelineRowCtx, type TimelineRow } from "../chat/timelineRowContext";
import { AssessmentCard } from "./AssessmentCard";
import { PlanMap } from "./PlanMap";
import { QuestionCard } from "./QuestionCard";
import { useLearningThread } from "./useLearningThread";

export function LearningTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "learning" }> }) {
  const ctx = use(TimelineRowCtx);
  const state = useLearningThread(ctx.threadRef);
  if (state === null || ctx.threadRef === null) return null;

  if (row.tool === "ask_question") {
    const question = state.questions.find((entry) => entry.id === row.questionId);
    return question === undefined ? null : (
      <div className="min-w-0 px-1">
        <QuestionCard question={question} threadRef={ctx.threadRef} markdownCwd={ctx.markdownCwd} />
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
