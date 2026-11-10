import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "~/composerDraftStore";

import { Button } from "../ui/button";

/** Each shows one way to use the tutor, and reads as a complete request when sent unchanged. */
const STARTER_QUESTIONS = [
  "I keep getting stuck on something. Ask me questions until you find exactly where my understanding breaks.",
  "I have a goal I want to reach. Help me plan what to learn, and in what order, to get there.",
  "I want to study from my own notes or a PDF. How do I share them, and how will you use them?",
  "Quiz me on something I think I already know, and show me what I actually get wrong.",
  "What have I learned so far, and what should I review today?",
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
