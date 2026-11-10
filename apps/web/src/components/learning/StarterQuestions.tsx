import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "~/composerDraftStore";

import { Button } from "../ui/button";

/** Each shows one way to use the tutor, and reads as a complete request when sent unchanged. */
const STARTER_QUESTIONS = [
  "There's something I sort of understand but can't explain. Ask me questions until you find where it breaks.",
  "I want to learn something new and don't know where to start. Ask me a few questions, then map out a path for me.",
  "I want to study from my own notes. I'll attach them with the paperclip; first ask me what I need to get out of them.",
  "Quiz me on something I've been studying, one problem at a time, and don't show me the answer until I've tried.",
  "What have I learned so far, and what's due for review today?",
] as const;

/** Shown under an empty quick-question composer; picking one fills the composer for the learner to edit. */
export function StarterQuestions(props: {
  readonly target: ComposerThreadTarget;
  readonly onPick: (question: string) => void;
}) {
  // A boolean, so typing does not re-render the list.
  const empty = useComposerDraftStore(
    (store) => !composerDraftHasUserContent(store.getComposerDraft(props.target)),
  );
  if (!empty) return null;
  return (
    <section aria-label="Questions to try" className="flex flex-col items-center gap-0.5">
      <p className="pb-1 text-muted-foreground text-xs">Not sure how to start? Try one of these.</p>
      {STARTER_QUESTIONS.map((question) => (
        <Button
          key={question}
          variant="ghost-muted"
          size="sm-multiline"
          onClick={() => props.onPick(question)}
        >
          {question}
        </Button>
      ))}
    </section>
  );
}
