// @vitest-environment jsdom
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { deriveError, type InteractionReason } from "../src/error/derive-error.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { studioVaaiUiMessagesForLocale } from "../src/i18n/messages.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { Button } from "../src/ui/button.js";
import { ErrorMessage } from "../src/ui/error-message.js";
import { testProduct } from "./helpers.js";

const ui = studioVaaiUiMessagesForLocale("en");

function vmWith(canStartTryOn: boolean): DefaultRootViewModel {
  return {
    phase: "product",
    productPhase: "active",
    variant: canStartTryOn ? "selected" : "selecting",
    recommendation: "hidden",
    tryOnPipeline: "idle",
    canStartTryOn,
  };
}

// Mirrors the product-overview try-on CTA: `disabled` when the selection is
// incomplete, with `onClickDisabled` wired to flag the interaction error.
function Harness({
  canStartTryOn,
  busy = false,
  onClick,
  onBlocked,
}: {
  canStartTryOn: boolean;
  busy?: boolean;
  onClick: () => void;
  onBlocked: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState<InteractionReason | undefined>();
  const error = deriveError({
    reason,
    consented: false,
    vm: vmWith(canStartTryOn),
    product: testProduct,
    selection: {},
    ui,
    machineError: undefined,
  });
  return (
    <StudioVaaiUiProvider locale="en">
      <ErrorProvider
        value={{
          error,
          setReason,
          clearReason: () => {
            setReason(undefined);
          },
        }}
      >
        <Button
          type="button"
          disabled={!canStartTryOn}
          busy={busy}
          onClick={onClick}
          onClickDisabled={() => {
            onBlocked();
            setReason("selectionRequired");
          }}
        >
          Try on
        </Button>
        <ErrorMessage />
      </ErrorProvider>
    </StudioVaaiUiProvider>
  );
}

describe("always-enabled CTA error", () => {
  it("shows the selection error when clicked with an incomplete selection", () => {
    const onClick = vi.fn<() => void>();
    const onBlocked = vi.fn<() => void>();
    render(<Harness canStartTryOn={false} onClick={onClick} onBlocked={onBlocked} />);
    fireEvent.click(screen.getByRole("button", { name: /try on/i }));
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.queryByText(/Please select a size and a color\./)).toBeTruthy();
  });

  it("does NOT error when the selection is complete — it just acts", () => {
    // Regression for the "no error on 'Größe M anprobieren'" confusion: with a
    // valid selection the button is genuinely enabled, so it runs onClick and
    // the (resolved) interaction reason surfaces nothing.
    const onClick = vi.fn<() => void>();
    const onBlocked = vi.fn<() => void>();
    render(<Harness canStartTryOn onClick={onClick} onBlocked={onBlocked} />);
    fireEvent.click(screen.getByRole("button", { name: /try on/i }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(screen.queryByText(/Please select/)).toBeNull();
  });

  it("routes the click to onClickDisabled while busy — never native-disabled, never double-fires", () => {
    const onClick = vi.fn<() => void>();
    const onBlocked = vi.fn<() => void>();
    render(<Harness canStartTryOn busy onClick={onClick} onBlocked={onBlocked} />);
    // During `busy` the visible label is aria-hidden, so query by role alone.
    const button = screen.getByRole("button");
    // With `onClickDisabled` wired, the native `disabled` attribute is never set
    // (a native-disabled button swallows the click), but it is `aria-disabled`.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    // Selection is valid, so the flagged reason resolves and nothing shows.
    expect(screen.queryByText(/Please select/)).toBeNull();
  });
});
