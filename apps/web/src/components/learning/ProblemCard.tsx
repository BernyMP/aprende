import type { LearningProblemView, ScopedThreadRef } from "@aprende/contracts";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ConfidenceField } from "./QuestionCard";

const MODE_LABEL: Record<LearningProblemView["mode"], string> = {
  recall: "Recall",
  discriminate: "Tell apart",
  compose: "Put it together",
};

const OUTCOME = {
  solved: { label: "Solved", variant: "success" },
  partial: { label: "Partly there", variant: "warning" },
  missed: { label: "Missed", variant: "error" },
} as const;

interface WorkDraft {
  readonly text: string;
  readonly confidence: number;
  readonly thinking: string;
}

// The timeline unmounts rows scrolled out of view; keep unsent work until it is submitted.
const workDrafts = new Map<string, WorkDraft>();

export function ProblemCard(props: {
  readonly problem: LearningProblemView;
  readonly threadRef: ScopedThreadRef;
  readonly markdownCwd: string | undefined;
  /** Set on the newest concluded problem when the learner can ask for another. */
  readonly onNextProblem: (() => Promise<void>) | undefined;
}) {
  const { problem } = props;
  return (
    <section
      className={cn(
        "rounded-xl border bg-card px-4 py-3.5 text-card-foreground",
        problem.status === "skipped" && "opacity-60",
      )}
      aria-label="Practice problem"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Practice · {MODE_LABEL[problem.mode]}
        </p>
        {problem.retestOf !== null ? (
          <Badge size="sm" variant="info">
            Retest
          </Badge>
        ) : null}
      </div>
      <ChatMarkdown text={problem.statement} cwd={props.markdownCwd} />
      <p className="mt-1.5 text-muted-foreground text-xs">
        Practices {problem.targets.map((target) => target.name).join(" · ")}
      </p>
      {problem.status === "open" ? (
        <OpenProblem
          problem={problem}
          threadRef={props.threadRef}
          markdownCwd={props.markdownCwd}
        />
      ) : problem.status === "submitted" ? (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <SubmittedWork problem={problem} />
          <p className="text-muted-foreground">Waiting for the tutor's verdict.</p>
        </div>
      ) : problem.status === "concluded" ? (
        <ConcludedProblem
          problem={problem}
          markdownCwd={props.markdownCwd}
          onNextProblem={props.onNextProblem}
        />
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">Replaced before you submitted it.</p>
      )}
    </section>
  );
}

function HintList(props: {
  readonly hints: ReadonlyArray<string>;
  readonly markdownCwd: string | undefined;
}) {
  if (props.hints.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {props.hints.map((hint, index) => (
        // Hints never reorder, so the position names one.
        // oxlint-disable-next-line react/no-array-index-key
        <li key={index} className="rounded-lg border bg-muted/40 px-3 py-2">
          <span className="font-medium text-muted-foreground text-xs">Hint {index + 1}</span>
          <ChatMarkdown text={hint} cwd={props.markdownCwd} />
        </li>
      ))}
    </ol>
  );
}

function OpenProblem(props: {
  readonly problem: LearningProblemView;
  readonly threadRef: ScopedThreadRef;
  readonly markdownCwd: string | undefined;
}) {
  const { problem } = props;
  const [draft, setDraftState] = useState<WorkDraft>(
    () => workDrafts.get(problem.id) ?? { text: "", confidence: 50, thinking: "" },
  );
  const [pending, setPending] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const revealHint = useAtomCommand(serverEnvironment.revealLearningHint, {
    label: "reveal hint",
  });
  const submitSolution = useAtomCommand(serverEnvironment.submitLearningSolution, {
    label: "submit your work",
  });
  const setDraft = (patch: Partial<WorkDraft>) => {
    const next = { ...draft, ...patch };
    workDrafts.set(problem.id, next);
    setDraftState(next);
  };
  const target = { threadId: props.threadRef.threadId, problemId: problem.id };

  const showHint = async () => {
    if (revealing) return;
    setRevealing(true);
    await revealHint({ environmentId: props.threadRef.environmentId, input: target });
    setRevealing(false);
  };

  const submit = async (gaveUp: boolean) => {
    if (pending) return;
    setPending(true);
    const result = await submitSolution({
      environmentId: props.threadRef.environmentId,
      input: {
        ...target,
        gaveUp,
        ...(draft.text.trim() ? { text: draft.text } : {}),
        ...(gaveUp ? {} : { confidence: draft.confidence }),
        ...(draft.thinking.trim() ? { thinking: draft.thinking } : {}),
      },
    });
    if (result._tag === "Failure") setPending(false);
    else workDrafts.delete(problem.id);
  };

  const hintsLeft = problem.hintCount - problem.hintsUsed;

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      <HintList hints={problem.hints} markdownCwd={props.markdownCwd} />
      <Textarea
        aria-label="Your work"
        size="lg"
        placeholder="Work it through here"
        value={draft.text}
        onChange={(event) => setDraft({ text: event.target.value })}
      />
      <ConfidenceField
        value={draft.confidence}
        onChange={(confidence) => setDraft({ confidence })}
      />
      <Textarea
        aria-label="Your thinking"
        size="sm"
        placeholder="Your thinking, out loud (optional)"
        value={draft.thinking}
        onChange={(event) => setDraft({ thinking: event.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" disabled={draft.text.trim().length === 0 || pending}>
          Submit
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={hintsLeft === 0 || revealing || pending}
          onClick={() => void showHint()}
        >
          {hintsLeft === 0
            ? "No hints left"
            : `Hint ${problem.hintsUsed + 1} of ${problem.hintCount}`}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void submit(true)}
        >
          Give up
        </Button>
      </div>
    </form>
  );
}

function SubmittedWork(props: { readonly problem: LearningProblemView }) {
  const attempt = props.problem.attempt;
  if (attempt === null) return null;
  return (
    <>
      {attempt.text !== undefined ? (
        <blockquote className="whitespace-pre-wrap border-l-2 pl-3">{attempt.text}</blockquote>
      ) : null}
      <p className="text-muted-foreground">
        {[
          attempt.gaveUp ? "You gave up on this one." : null,
          attempt.confidence === undefined ? null : `You were ${attempt.confidence}% sure.`,
          props.problem.hintCount === 0
            ? null
            : `You used ${props.problem.hintsUsed} of ${props.problem.hintCount} hints.`,
        ]
          .filter((part) => part !== null)
          .join(" ")}
      </p>
      {attempt.thinking ? (
        <p className="text-muted-foreground">
          <span className="font-medium">Your thinking:</span> {attempt.thinking}
        </p>
      ) : null}
    </>
  );
}

function ConcludedProblem(props: {
  readonly problem: LearningProblemView;
  readonly markdownCwd: string | undefined;
  readonly onNextProblem: (() => Promise<void>) | undefined;
}) {
  const { problem } = props;
  const [asked, setAsked] = useState(false);
  const conclusion = problem.conclusion;
  if (conclusion === null) return null;
  const outcome = OUTCOME[conclusion.outcome];
  const askNext = async () => {
    if (props.onNextProblem === undefined || asked) return;
    setAsked(true);
    await props.onNextProblem().catch(() => setAsked(false));
  };
  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      <SubmittedWork problem={problem} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Badge variant={outcome.variant}>{outcome.label}</Badge>
          {conclusion.retest ? (
            <span className="text-muted-foreground text-xs">You'll get another try later.</span>
          ) : null}
        </div>
        <ChatMarkdown text={conclusion.verdict} cwd={props.markdownCwd} />
      </div>
      {problem.modelSolution !== null ? (
        <div>
          <p className="font-medium">A complete solution</p>
          <ChatMarkdown text={problem.modelSolution} cwd={props.markdownCwd} />
        </div>
      ) : null}
      {problem.hints.length > 0 ? (
        <details>
          <summary className="cursor-pointer font-medium">Hints</summary>
          <div className="mt-2">
            <HintList hints={problem.hints} markdownCwd={props.markdownCwd} />
          </div>
        </details>
      ) : null}
      {props.onNextProblem !== undefined ? (
        <div>
          <Button size="sm" variant="outline" disabled={asked} onClick={() => void askNext()}>
            Next problem
          </Button>
        </div>
      ) : null}
    </div>
  );
}
