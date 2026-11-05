import { assert, describe, it } from "@effect/vitest";

import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("names the harness and model", () => {
    const instructions = buildRuntimeInstructions({
      harness: "Antigravity",
      model: "gemini-3.8-flash",
    });

    assert.include(instructions, "through the Antigravity harness, as gemini-3.8-flash.");
  });
});
