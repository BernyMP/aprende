import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "~/composerDraftStore";

import { Button } from "../ui/button";

/** Each shows one way to use the tutor; its request reads as complete when sent unchanged. */
const STARTER_QUESTIONS = [
  {
    label: "Where does my understanding break?",
    request:
      "There's something I sort of understand but can't explain. Ask me questions until you find where it breaks.",
  },
  {
    label: "Where do I start with something new?",
    request:
      "I want to learn something new and don't know where to start. Ask me a few questions, then map out a path for me.",
  },
  {
    label: "Can I study from my own notes?",
    request:
      "I want to study from my own notes. I'll attach them with the paperclip; first ask me what I need to get out of them.",
  },
  {
    label: "Can you quiz me?",
    request:
      "Quiz me on something I've been studying, one problem at a time, and don't show me the answer until I've tried.",
  },
  {
    label: "What's due for review today?",
    request: "What have I learned so far, and what's due for review today?",
  },
] as const;

/** Shown under an empty quick-question composer; picking one fills the composer for the learner to edit. */
export function StarterQuestions(props: {
  readonly target: ComposerThreadTarget;
  readonly onPick: (request: string) => void;
}) {
  // A boolean, so typing does not re-render the list.
  const empty = useComposerDraftStore(
    (store) => !composerDraftHasUserContent(store.getComposerDraft(props.target)),
  );
  if (!empty) return null;
  return (
    <section aria-label="Questions to try" className="flex flex-col items-center gap-2">
      <p className="text-muted-foreground text-xs">Not sure how to start? Try one of these.</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {STARTER_QUESTIONS.map((question) => (
          <Button
            key={question.label}
            variant="outline"
            size="sm"
            onClick={() => props.onPick(question.request)}
          >
            {question.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
