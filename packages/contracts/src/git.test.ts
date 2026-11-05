import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { GitCommandError } from "./git.ts";

const decodeGitCommandError = Schema.decodeUnknownSync(Schema.toCodecJson(GitCommandError));

describe("GitCommandError", () => {
  it("decodes an unknown failure reason as absent", () => {
    const error = decodeGitCommandError({
      _tag: "GitCommandError",
      operation: "GitVcsDriver.createWorktree",
      command: "git",
      cwd: "/repo",
      detail: "git worktree add failed",
      reason: "added_by_a_newer_server",
    });

    expect(error.reason).toBeUndefined();
    expect(error.message).toBe(
      "Git command failed in GitVcsDriver.createWorktree (/repo): git worktree add failed",
    );
  });
});
