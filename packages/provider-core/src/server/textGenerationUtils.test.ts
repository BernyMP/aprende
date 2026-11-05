import { describe, expect, it } from "vite-plus/test";

import { limitSection, sanitizeThreadTitle } from "./textGenerationUtils.ts";

describe("limitSection", () => {
  it("cuts a long section without splitting an emoji", () => {
    expect(limitSection(`${"a".repeat(9)}🚀 more`, 10)).toBe(`${"a".repeat(9)}\n\n[truncated]`);
  });
});

describe("sanitizeThreadTitle", () => {
  it.each([
    { name: "a split surrogate pair", prefixLength: 116, character: "🚀", retained: "" },
    { name: "a complete surrogate pair", prefixLength: 115, character: "🚀", retained: "🚀" },
    { name: "a BMP character", prefixLength: 116, character: "界", retained: "界" },
  ])("truncates without splitting $name", ({ prefixLength, character, retained }) => {
    const prefix = "a".repeat(prefixLength);
    const title = `${prefix}${character} more`;

    expect(sanitizeThreadTitle(title)).toBe(`${prefix}${retained}...`);
  });
});
