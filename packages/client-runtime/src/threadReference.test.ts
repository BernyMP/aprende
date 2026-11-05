import { EnvironmentId, ThreadId } from "@aprende/contracts";
import {
  decodeComposerContextFragment,
  encodeComposerContextFragment,
} from "@aprende/shared/composerContextClipboard";
import { threadLinkContextReferences } from "@aprende/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { threadChipCopyTarget } from "./threadReference.ts";

const thread = {
  threadRef: { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("thread-1") },
  title: "Fix the login flow",
};

describe("threadChipCopyTarget", () => {
  it("copies a thread chip that pastes back as the same thread on its machine", () => {
    const target = threadChipCopyTarget(thread.threadRef, thread.title);

    expect(target).toMatchObject({
      kind: "thread",
      description: "Fix the login flow",
      successTitle: "Thread copied",
    });
    const pasted = decodeComposerContextFragment(encodeComposerContextFragment(target.fragment!));
    expect(pasted).toEqual({
      version: 1,
      source: { environmentId: "env-1" },
      records: [
        expect.objectContaining({
          kind: "thread",
          environmentId: "env-1",
          threadId: "thread-1",
          title: "Fix the login flow",
        }),
      ],
    });
    // The plain text opens the thread anywhere and pastes back as the copied record's chip.
    expect(target.value).toBe("https://app.aprende.invalid/threads/env-1/thread-1");
    expect(threadLinkContextReferences(target.value, pasted!.records, () => undefined)).toEqual({
      text: `[Fix the login flow](t3-context://v1/thread/${pasted!.records[0]!.contextId})`,
      records: pasted!.records,
    });
  });

  it("links through the build's hosted app", () => {
    expect(
      threadChipCopyTarget(thread.threadRef, thread.title, "https://preview.aprende.invalid").value,
    ).toBe("https://preview.aprende.invalid/threads/env-1/thread-1");
  });
});
