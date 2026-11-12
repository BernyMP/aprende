import {
  LEARNING_CHECK_TIMEOUT_SECONDS,
  type LearningCheckOutcome,
  type LearningCheckRun,
  type LearningProblemView,
  type LearningProblemWorkspace,
  type ScopedThreadRef,
} from "@aprende/contracts";
import { useAtomValue } from "@effect/atom-react";
import { FolderOpenIcon, PlayIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { flushFileSaveFolder } from "../files/fileSaveSessions";
import { toastManager } from "../ui/toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { LabelMarkdown } from "./QuestionCard";

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
  /** One per part, for a problem with parts. */
  readonly answers: ReadonlyArray<string>;
}

// The timeline unmounts rows scrolled out of view; keep unsent work until it is submitted.
const workDrafts = new Map<string, WorkDraft>();
// And keep the last check run of each problem, for the same reason.
const lastRuns = new Map<string, LearningCheckRun>();

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
      <div className="flex items-center gap-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Practice · {MODE_LABEL[problem.mode]}
        </p>
        {problem.retestOf !== null ? (
          <Badge size="sm" variant="info">
            Retest
          </Badge>
        ) : null}
      </div>
      <p className="mb-2 text-muted-foreground text-xs">
        Practices {problem.targets.map((target) => target.name).join(" · ")}
      </p>
      <ChatMarkdown text={problem.statement} cwd={props.markdownCwd} />
      {problem.workspace !== null ? (
        <Workspace
          problem={problem}
          workspace={problem.workspace}
          threadRef={props.threadRef}
          cwd={props.markdownCwd}
        />
      ) : null}
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
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <Parts problem={problem} answers={undefined} />
          <p className="text-muted-foreground">Replaced before you submitted it.</p>
        </div>
      )}
    </section>
  );
}

/** A problem's parts: a field each while it is open, then what was handed in for each. */
function Parts(props: {
  readonly problem: LearningProblemView;
  readonly answers: ReadonlyArray<string> | undefined;
  readonly onChange?: (answers: ReadonlyArray<string>) => void;
}) {
  const { problem, answers, onChange } = props;
  if (problem.parts.length === 0) return null;
  return (
    <ol className="flex flex-col gap-3 text-sm">
      {problem.parts.map((part, index) => {
        const labelId = `${problem.id}-part-${index}`;
        const answer = answers?.[index] ?? "";
        return (
          // Parts never reorder, so the position names one.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={index} className="flex flex-col gap-1.5">
            <div id={labelId} className="flex gap-2">
              <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
              <LabelMarkdown text={part} />
            </div>
            {onChange !== undefined ? (
              <Textarea
                aria-labelledby={labelId}
                size="line"
                value={answer}
                onChange={(event) =>
                  onChange(
                    problem.parts.map((_, at) =>
                      at === index ? event.target.value : (answers?.[at] ?? ""),
                    ),
                  )
                }
              />
            ) : answers !== undefined ? (
              <blockquote className="whitespace-pre-wrap border-l-2 pl-3">
                {answer.length > 0 ? (
                  answer
                ) : (
                  <span className="text-muted-foreground">Left blank</span>
                )}
              </blockquote>
            ) : null}
          </li>
        );
      })}
    </ol>
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

const checkLabel = (check: LearningCheckOutcome) =>
  check.timedOut
    ? { label: `Stopped after ${LEARNING_CHECK_TIMEOUT_SECONDS} s`, variant: "warning" as const }
    : check.exitCode === null
      ? { label: "Could not run", variant: "error" as const }
      : check.exitCode === 0
        ? { label: "Passed", variant: "success" as const }
        : { label: `Failed with exit code ${check.exitCode}`, variant: "error" as const };

/** Saves open edits in the practice folder, so a run or a submit sees what the learner sees. */
const saveWorkspace = async (
  threadRef: ScopedThreadRef,
  cwd: string | undefined,
  workspace: LearningProblemWorkspace | null,
) => {
  if (cwd === undefined || workspace === null) return true;
  const saved = await flushFileSaveFolder({
    environmentId: threadRef.environmentId,
    cwd,
    folder: workspace.folder,
    files: workspace.files,
  });
  if (!saved)
    toastManager.add({
      type: "error",
      title: "Your changes are not saved",
      description: `Save your files in ${workspace.folder}, then try again.`,
    });
  return saved;
};

function Workspace(props: {
  readonly problem: LearningProblemView;
  readonly workspace: LearningProblemWorkspace;
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | undefined;
}) {
  const { problem, workspace, threadRef } = props;
  const [run, setRun] = useState(() => lastRuns.get(problem.id) ?? null);
  const [running, setRunning] = useState(false);
  const canRun = useAtomValue(
    serverEnvironment.runLearningCheck.permissionAtom(threadRef.environmentId),
  );
  const runCheck = useAtomCommand(serverEnvironment.runLearningCheck, { label: "run the check" });
  const canOpenTerminal = useAtomValue(
    serverEnvironment.openPracticeTerminal.permissionAtom(threadRef.environmentId),
  );
  const first = workspace.files[0];

  const runIt = async () => {
    if (running) return;
    setRunning(true);
    if (!(await saveWorkspace(threadRef, props.cwd, workspace))) {
      setRunning(false);
      return;
    }
    const result = await runCheck({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, problemId: problem.id },
    });
    setRunning(false);
    if (result._tag !== "Success") return;
    lastRuns.set(problem.id, result.value);
    setRun(result.value);
  };

  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            useRightPanelStore
              .getState()
              .openFile(
                threadRef,
                first === undefined ? workspace.folder : `${workspace.folder}/${first}`,
              )
          }
        >
          <FolderOpenIcon />
          Open {workspace.folder}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={canOpenTerminal === false}
          onClick={() =>
            useRightPanelStore.getState().openPracticeTerminal(threadRef, {
              threadId: threadRef.threadId,
              problemId: problem.id,
              folder: workspace.folder,
            })
          }
        >
          <SquareTerminalIcon />
          Terminal
        </Button>
        {workspace.checkCommand !== null ? (
          <Button
            size="sm"
            variant="outline"
            disabled={running || canRun === false}
            onClick={() => void runIt()}
          >
            <PlayIcon />
            {running ? "Running…" : "Run check"}
          </Button>
        ) : null}
      </div>
      {workspace.checkCommand !== null ? (
        <p className="text-muted-foreground text-xs">
          The check runs <code>{workspace.checkCommand}</code> on your computer, as your own
          terminal would.
        </p>
      ) : null}
      {run !== null ? <CheckOutput run={run} /> : null}
    </div>
  );
}

function CheckOutput(props: { readonly run: LearningCheckRun }) {
  const { run } = props;
  const status = checkLabel(run);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Badge size="sm" variant={status.variant}>
          {status.label}
        </Badge>
        {run.truncated ? (
          <span className="text-muted-foreground text-xs">Output cut to fit.</span>
        ) : null}
      </div>
      <pre
        aria-label="Check output"
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs"
      >
        {run.output.length > 0 ? run.output : "No output."}
      </pre>
    </div>
  );
}

function OpenProblem(props: {
  readonly problem: LearningProblemView;
  readonly threadRef: ScopedThreadRef;
  readonly markdownCwd: string | undefined;
}) {
  const { problem } = props;
  const [draft, setDraftState] = useState<WorkDraft>(
    () => workDrafts.get(problem.id) ?? { text: "", answers: [] },
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

  const coding = problem.workspace !== null;
  const hasParts = problem.parts.length > 0;
  const answers = problem.parts.map((_, index) => draft.answers[index] ?? "");
  const hasWork = hasParts
    ? answers.some((answer) => answer.trim().length > 0)
    : draft.text.trim().length > 0;
  const submit = async (gaveUp: boolean) => {
    if (pending) return;
    setPending(true);
    if (!gaveUp && !(await saveWorkspace(props.threadRef, props.markdownCwd, problem.workspace))) {
      setPending(false);
      return;
    }
    const result = await submitSolution({
      environmentId: props.threadRef.environmentId,
      input: {
        ...target,
        gaveUp,
        ...(hasParts ? { answers } : draft.text.trim() ? { text: draft.text } : {}),
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
      {coding ? null : hasParts ? (
        <Parts
          problem={problem}
          answers={answers}
          onChange={(next) => setDraft({ answers: next })}
        />
      ) : (
        <Textarea
          aria-label="Your work"
          size="lg"
          placeholder="Work it through here"
          value={draft.text}
          onChange={(event) => setDraft({ text: event.target.value })}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" disabled={(!coding && !hasWork) || pending}>
          {pending && (problem.workspace?.checkCommand ?? null) !== null
            ? "Running the check…"
            : "Submit"}
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
      <Parts problem={props.problem} answers={attempt.answers ?? []} />
      {attempt.text !== undefined ? (
        <blockquote className="whitespace-pre-wrap border-l-2 pl-3">{attempt.text}</blockquote>
      ) : null}
      <p className="text-muted-foreground">
        {[
          attempt.gaveUp ? "You gave up on this one." : null,
          attempt.check === undefined
            ? null
            : `Check on submit: ${checkLabel(attempt.check).label}.`,
          props.problem.hintCount === 0
            ? null
            : `You used ${props.problem.hintsUsed} of ${props.problem.hintCount} hints.`,
        ]
          .filter((part) => part !== null)
          .join(" ")}
      </p>
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
