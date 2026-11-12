import type { LearningQuestionView, ScopedThreadRef } from "@aprende/contracts";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { OPTION_MARKDOWN_PLUGINS } from "./QuestionCard.logic";

const PURPOSE_LABEL: Record<LearningQuestionView["purpose"], string> = {
  goal: "About your goal",
  measure: "Where you are",
  predict: "Predict",
  check: "Check your understanding",
};

const optionLabel = (index: number) => String.fromCharCode(65 + index);

// No cwd, so relative paths stay code rather than file-link chips nested in a button or label.
export function LabelMarkdown(props: { readonly text: string }) {
  return (
    <ChatMarkdown
      inline
      text={props.text}
      cwd={undefined}
      parseRawHtml={false}
      extraRemarkPlugins={OPTION_MARKDOWN_PLUGINS}
    />
  );
}

export function QuestionCard(props: {
  readonly question: LearningQuestionView;
  readonly threadRef: ScopedThreadRef;
  readonly markdownCwd: string | undefined;
}) {
  const { question } = props;
  return (
    <section
      className={cn(
        "rounded-xl border bg-card px-4 py-3.5 text-card-foreground",
        question.status === "skipped" && "opacity-60",
      )}
      aria-label={PURPOSE_LABEL[question.purpose]}
    >
      <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {PURPOSE_LABEL[question.purpose]}
      </p>
      <ChatMarkdown text={question.prompt} cwd={props.markdownCwd} />
      {question.status === "open" ? (
        <OpenQuestion question={question} threadRef={props.threadRef} />
      ) : question.status === "answered" ? (
        <AnsweredQuestion question={question} markdownCwd={props.markdownCwd} />
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">Replaced by a newer question.</p>
      )}
    </section>
  );
}

function OpenQuestion(props: {
  readonly question: LearningQuestionView;
  readonly threadRef: ScopedThreadRef;
}) {
  const { question } = props;
  // Checks come after reading; folding them keeps the explanation in focus until the learner is ready.
  const [unfolded, setUnfolded] = useState(question.purpose !== "check");
  const [selected, setSelected] = useState<ReadonlyArray<number>>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const answer = useAtomCommand(serverEnvironment.answerLearningQuestion, {
    label: "answer question",
  });
  const graded = question.purpose !== "goal";

  if (!unfolded) {
    return (
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={() => setUnfolded(true)}>
          Check your understanding
        </Button>
      </div>
    );
  }

  const toggle = (index: number) =>
    setSelected((current) =>
      question.allowMultiple
        ? current.includes(index)
          ? current.filter((entry) => entry !== index)
          : [...current, index]
        : [index],
    );

  const submit = async (dontKnow: boolean) => {
    if (pending) return;
    setPending(true);
    const result = await answer({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        questionId: question.id,
        selectedOptions: dontKnow ? [] : selected,
        dontKnow,
        ...(question.format === "recall" && !dontKnow ? { text } : {}),
      },
    });
    if (result._tag === "Failure") setPending(false);
  };

  const ready = question.format === "choice" ? selected.length > 0 : text.trim().length > 0;

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(false);
      }}
    >
      {question.format === "choice" ? (
        <div
          className="flex flex-col gap-1.5"
          role={question.allowMultiple ? "group" : "radiogroup"}
        >
          {question.options.map((option, index) => {
            const checked = selected.includes(index);
            return (
              <button
                key={option}
                type="button"
                role={question.allowMultiple ? "checkbox" : "radio"}
                aria-checked={checked}
                onClick={() => toggle(index)}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  checked ? "border-primary bg-primary/8" : "hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "mt-px font-medium tabular-nums",
                    checked ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {optionLabel(index)}
                </span>
                <span className="min-w-0">
                  <LabelMarkdown text={option} />
                </span>
              </button>
            );
          })}
          {question.allowMultiple ? (
            <p className="text-muted-foreground text-xs">Pick every option that applies.</p>
          ) : null}
        </div>
      ) : (
        <Textarea
          aria-label="Your answer"
          placeholder="Answer in your own words"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" disabled={!ready || pending}>
          Answer
        </Button>
        {graded ? (
          <Button
            size="sm"
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => void submit(true)}
          >
            I don't know
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function AnsweredQuestion(props: {
  readonly question: LearningQuestionView;
  readonly markdownCwd: string | undefined;
}) {
  const { question } = props;
  const answer = question.answer;
  if (answer === null) return null;
  const correctOptions = question.reveal?.correctOptions ?? [];
  const graded = correctOptions.length > 0;
  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      {question.format === "choice" ? (
        <ul className="flex flex-col gap-1.5">
          {question.options.map((option, index) => {
            const chosen = answer.selectedOptions.includes(index);
            const correct = correctOptions.includes(index);
            return (
              <li
                key={option}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3 py-2",
                  correct && "border-success/50 bg-success/8",
                  graded && chosen && !correct && "border-destructive/50 bg-destructive/8",
                  !chosen && !correct && "text-muted-foreground",
                )}
              >
                <span className="mt-px font-medium tabular-nums">{optionLabel(index)}</span>
                <span className="min-w-0 flex-1">
                  <LabelMarkdown text={option} />
                </span>
                {chosen ? (
                  correct || !graded ? (
                    <CheckIcon aria-label="Your answer" className="size-4 text-success" />
                  ) : (
                    <XIcon aria-label="Your answer" className="size-4 text-destructive" />
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : answer.text !== undefined ? (
        <blockquote className="border-l-2 pl-3">{answer.text}</blockquote>
      ) : null}
      {answer.dontKnow || answer.correct !== null ? (
        <p className="text-muted-foreground">
          {answer.dontKnow
            ? "You said you don't know yet."
            : answer.correct
              ? "Correct."
              : "Not quite."}
        </p>
      ) : null}
      {question.reveal?.modelAnswer ? (
        <div>
          <p className="font-medium">A complete answer</p>
          <ChatMarkdown text={question.reveal.modelAnswer} cwd={props.markdownCwd} />
        </div>
      ) : null}
      {question.reveal?.explanation ? (
        <div>
          <p className="font-medium">Why</p>
          <ChatMarkdown text={question.reveal.explanation} cwd={props.markdownCwd} />
        </div>
      ) : null}
    </div>
  );
}
