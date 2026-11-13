/** @vitest-environment jsdom */

import type React from "react";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorProvider } from "../src/error/error-context.js";
import { ErrorMessage } from "../src/ui/error-message.js";

const noop = (): void => {
  // These tests never exercise the click-disabled path.
};

/** `ErrorMessage` reads the flow's error context; these tests pass copy as children instead. */
function renderMessage(node: React.ReactNode) {
  return render(
    <ErrorProvider value={{ error: undefined, setReason: noop, clearReason: noop }}>
      {node}
    </ErrorProvider>,
  );
}

/**
 * Both variants must mark a failure with more than colour: red text alone is invisible to a
 * shopper who cannot separate it from the surrounding copy, and it is what made a system error
 * on the size step read like a footnote under the picker rather than a stop.
 */
describe("ErrorMessage", () => {
  it("boxes the card variant and gives it an alert glyph", () => {
    const { container } = renderMessage(<ErrorMessage variant="card">Upload failed</ErrorMessage>);
    const card = container.querySelector('[data-studio-vaai="error-card"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Upload failed");
  });

  it("gives the inline variant the same glyph", () => {
    const { container } = renderMessage(<ErrorMessage>Try-on in 32 failed</ErrorMessage>);
    // Inline is NOT boxed — it qualifies the control below it rather than owning the screen.
    expect(container.querySelector('[data-studio-vaai="error-card"]')).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Try-on in 32 failed");
  });

  it("announces itself either way", () => {
    for (const variant of ["card", "inline"] as const) {
      const { container } = renderMessage(<ErrorMessage variant={variant}>Boom</ErrorMessage>);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    }
  });

  it("renders nothing when there is no message", () => {
    const { container } = renderMessage(<ErrorMessage />);
    expect(container.innerHTML).toBe("");
  });
});
