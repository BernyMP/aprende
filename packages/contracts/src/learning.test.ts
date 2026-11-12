import { describe, expect, it } from "vite-plus/test";

import { isBlankStrandPhrase, learningStrandLevel } from "./learning.ts";

describe("isBlankStrandPhrase", () => {
  it.each([
    [undefined, true],
    [" ", true],
    ["Not found", true],
    ["None observed.", true],
    ["Nothing yet", true],
    ["None of the members of a union are usable until narrowed", false],
    ["`T` stays generic", false],
    ["Narrowing with typeof", false],
  ] as const)("%j is blank: %s", (phrase, blank) => {
    expect(isBlankStrandPhrase(phrase)).toBe(blank);
  });
});

describe("learningStrandLevel", () => {
  it.each([
    [{ level: "new", solid: "Loops", breaksAt: "Recursion" }, "new"],
    [{ solid: "typeof and object literals", breaksAt: "Not found" }, "solid"],
    [{ solid: "Nothing yet", breaksAt: "Thought the result stays `T`" }, "new"],
    [{ solid: "Reading an interface", breaksAt: "Optional still has a type" }, "partial"],
  ] as const)("reads %j as %s", (strand, level) => {
    expect(learningStrandLevel({ name: "Strand", startFrom: "Anything", ...strand })).toBe(level);
  });
});
