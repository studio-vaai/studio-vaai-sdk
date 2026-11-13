// @vitest-environment jsdom

import type { TryOnProductStyleOption } from "@studio-vaai/js-machine";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { StyleToggle } from "../src/ui/style-toggle.js";

const styles: readonly TryOnProductStyleOption[] = [
  { slug: "buttoned-up", label: "Buttoned", glyph: "buttoned-up" },
  { slug: "buttoned-down", label: "Unbuttoned", iconUrl: "https://example.com/open.svg" },
];

describe("StyleToggle", () => {
  afterEach(cleanup);

  it("presses the selected style and reports a tap on the other", () => {
    const onSelect = vi.fn<(slug: string) => void>();
    render(
      <StudioVaaiUiProvider locale="en">
        <StyleToggle styles={styles} selected="buttoned-up" onSelect={onSelect} label="Style" />
      </StudioVaaiUiProvider>,
    );

    const group = screen.getByRole("group", { name: "Style" });
    expect(group.dataset.svAxis).toBe("template");
    const up = screen.getByRole("button", { name: "Buttoned" });
    const down = screen.getByRole("button", { name: "Unbuttoned" });
    expect(up.getAttribute("aria-pressed")).toBe("true");
    expect(down.getAttribute("aria-pressed")).toBe("false");
    // Built-in glyph for the first, the host's icon for the second.
    expect(up.querySelector("svg")).not.toBeNull();
    expect(down.querySelector("img")?.getAttribute("src")).toBe("https://example.com/open.svg");
    // The chosen segment is OUTLINED on the surface colour, never filled solid: it sits in the
    // tried-variant row and has to read like that row's selected pill.
    expect(up.className).toContain("sv:ring-inset");
    expect(up.className).not.toContain("sv:bg-[var(--sv-color-primary)]");
    expect(down.className).not.toContain("sv:ring-inset");

    fireEvent.click(down);
    expect(onSelect).toHaveBeenCalledWith("buttoned-down");
  });

  it("ignores taps while disabled", () => {
    const onSelect = vi.fn<(slug: string) => void>();
    render(
      <StudioVaaiUiProvider locale="en">
        <StyleToggle
          styles={styles}
          selected="buttoned-up"
          onSelect={onSelect}
          label="Style"
          disabled
        />
      </StudioVaaiUiProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unbuttoned" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
