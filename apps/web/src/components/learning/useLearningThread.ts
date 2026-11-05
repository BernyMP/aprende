import type { LearningThreadState, ScopedThreadRef } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

/** The thread's live learning record: questions, assessment and plan. */
export function useLearningThread(
  threadRef: ScopedThreadRef | null | undefined,
): LearningThreadState | null {
  return useEnvironmentQuery(
    threadRef
      ? serverEnvironment.learningThreadLive({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  ).data;
}
