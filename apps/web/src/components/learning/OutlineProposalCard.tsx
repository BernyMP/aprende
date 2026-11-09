import type { EnvironmentId, LearningOutlineProposal } from "@aprende/contracts";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { describeOutlineOp } from "./notebook.logic";
import { reportNotebookResult, useNotebook } from "./useNotebook";

const OUTCOME: Record<Exclude<LearningOutlineProposal["status"], "pending">, string> = {
  accepted: "Applied to your outline.",
  dismissed: "Dismissed.",
  replaced: "Replaced by a newer suggestion.",
};

/** The tutor's suggested outline change. It applies only when the learner accepts it. */
export function OutlineProposalCard(props: {
  readonly proposal: LearningOutlineProposal;
  readonly environmentId: EnvironmentId;
}) {
  const { proposal } = props;
  const notebook = useNotebook(props.environmentId, proposal.projectId);
  const resolve = useAtomCommand(serverEnvironment.resolveOutlineProposal, {
    label: "change your outline",
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  const titles = new Map((notebook?.outline.topics ?? []).map((topic) => [topic.id, topic.title]));
  const first =
    proposal.status === "pending" &&
    notebook?.outline.topics.length === 0 &&
    proposal.ops.every((op) => op.type === "add");

  const decide = async (accept: boolean) => {
    setPending(true);
    reportNotebookResult(
      await resolve({
        environmentId: props.environmentId,
        input: { proposalId: proposal.id, accept },
      }),
      "Could not change your outline",
    );
    setPending(false);
  };

  return (
    <section
      className={cn(
        "rounded-xl border bg-card px-4 py-3.5 text-card-foreground text-sm",
        proposal.status === "replaced" && "opacity-60",
      )}
      aria-label="Suggested outline change"
    >
      <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {first ? "A first outline for this notebook" : "Suggested outline change"}
      </p>
      <p>{proposal.reason}</p>
      {first ? (
        <ol className="mt-2 list-decimal pl-5">
          {proposal.ops.map((op) =>
            op.type === "add" ? <li key={JSON.stringify(op)}>{op.title}</li> : null,
          )}
        </ol>
      ) : (
        <ul className="mt-2 flex flex-col gap-0.5 text-muted-foreground">
          {proposal.ops.map((op) => (
            <li key={JSON.stringify(op)}>{describeOutlineOp(op, titles)}</li>
          ))}
        </ul>
      )}
      {proposal.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void decide(true)}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => void decide(false)}>
            Dismiss
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">{OUTCOME[proposal.status]}</p>
      )}
    </section>
  );
}
