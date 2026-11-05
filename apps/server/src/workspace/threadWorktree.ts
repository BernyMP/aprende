import { CommandId, type ThreadId } from "@aprende/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

/**
 * Threads from older releases may record a worktree that has since been removed. Every consumer
 * treats such a thread as running in its project root; nothing recreates the checkout.
 */
export const existingThreadWorktree = Effect.fn("ThreadWorktree.existing")(function* (
  fileSystem: FileSystem.FileSystem,
  worktreePath: string | null,
) {
  if (worktreePath === null) return null;
  const exists = yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => true));
  return exists ? worktreePath : null;
});

/**
 * Like `existingThreadWorktree`, and also clears a removed worktree from the thread, so clients
 * and every server reader agree on the project root. The clear never detaches live sessions.
 */
export const forgetRemovedThreadWorktree = Effect.fn("ThreadWorktree.forgetRemoved")(function* (
  fileSystem: FileSystem.FileSystem,
  dispatch: ThreadManagementService.ThreadManagementService["Service"]["dispatch"],
  thread: { readonly id: ThreadId; readonly worktreePath: string | null },
) {
  const worktree = yield* existingThreadWorktree(fileSystem, thread.worktreePath);
  if (worktree !== null || thread.worktreePath === null) return worktree;
  yield* dispatch({
    type: "thread.metadata.update",
    commandId: CommandId.make(`thread-worktree-removed:${thread.id}:${thread.worktreePath}`),
    threadId: thread.id,
    worktreePath: null,
    expectedWorktreePath: thread.worktreePath,
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("thread-worktree.forget-failed", { threadId: thread.id, cause }),
    ),
  );
  return null;
});
