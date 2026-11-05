import { describe, expect, it } from "vite-plus/test";

import { deriveAvailableInstanceId } from "./providerInstanceIds.ts";

describe("deriveAvailableInstanceId", () => {
  it("derives a collision-free instance id without exceeding the slug limit", () => {
    const derive = (label: string) => `codex_${label}`;
    const existing = new Set(["codex_work", "codex_work_2"]);

    expect(deriveAvailableInstanceId(derive, "work", existing)).toBe("codex_work_3");

    const longBase = `codex_${"a".repeat(54)}`;
    expect(deriveAvailableInstanceId(() => longBase, "ignored", new Set([longBase]))).toHaveLength(
      62,
    );
  });
});
