import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

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
