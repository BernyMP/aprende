import type { ThreadStructure } from "@aprende/client-runtime/state/shell";
import type { RunId, ScopedThreadRef } from "@aprende/contracts";
import { workspacePreparationRetryRunIds } from "@aprende/client-runtime/state/turn-item-presentation";
import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

// Share in-flight preparation retries across ChatView instances.
const retryingWorkspacePreparationRunIds = new Set<RunId>();

/** Runs whose workspace preparation failed and can be retried, and the retry itself. */
export function useWorkspacePreparationRetry(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly serverProjection: ThreadStructure | null;
}) {
  const { threadRef, serverProjection } = input;
  const retryWorkspacePreparation = useAtomCommand(threadEnvironment.retryWorkspacePreparation);
  const retryableRunIdsKey = [
    ...workspacePreparationRetryRunIds(
      serverProjection?.runs ?? [],
      serverProjection?.turnItems ?? [],
    ),
  ].join("\n");
  const [retryableRunIds, setRetryableRunIds] = useState({
    key: retryableRunIdsKey,
    ids: new Set(retryableRunIdsKey === "" ? [] : (retryableRunIdsKey.split("\n") as RunId[])),
  });
  if (retryableRunIds.key !== retryableRunIdsKey) {
    setRetryableRunIds({
      key: retryableRunIdsKey,
      ids: new Set(retryableRunIdsKey === "" ? [] : (retryableRunIdsKey.split("\n") as RunId[])),
    });
  }
  const retryPreparation = useStableCallback((runId: RunId) => {
    if (!threadRef || retryingWorkspacePreparationRunIds.has(runId)) return;
    retryingWorkspacePreparationRunIds.add(runId);
    void retryWorkspacePreparation({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, runId },
    }).finally(() => retryingWorkspacePreparationRunIds.delete(runId));
  });
  return { retryableRunIds: retryableRunIds.ids, retryPreparation };
}
