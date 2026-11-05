import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";

describe("ProviderEnvironmentSection", () => {
  it("holds a credential-named variable back and saves plain CLI settings", async () => {
    const onChange = vi.fn();
    await using screen = await render(
      <ProviderEnvironmentSection environment={[]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add variable" }));
    const name = screen.getByRole("textbox", { name: "Environment variable name 1" });

    await userEvent.fill(name, "ANTHROPIC_API_KEY");
    await userEvent.tab();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("aprende doesn't store credentials. Sign in with the CLI instead.");
    expect(screen.getByLabelText("Environment variable value 1").query()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.fill(name, "ANTHROPIC_BASE_URL");
    await userEvent.tab();
    await userEvent.fill(
      screen.getByLabelText("Environment variable value 1"),
      "https://proxy.example.test",
    );
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith([
      { name: "ANTHROPIC_BASE_URL", value: "https://proxy.example.test" },
    ]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove environment variable ANTHROPIC_BASE_URL" }),
    );
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
