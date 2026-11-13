// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { SessionIntroScreen } from "../src/batteries/session-intro-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";

class ResizeObserverMock {
  constructor(_callback: ResizeObserverCallback) {
    void _callback;
  }

  observe(_target: Element): void {
    void this;
    void _target;
  }

  disconnect(): void {
    void this;
  }
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

/** jsdom has no `matchMedia`; without one the provider falls back to its `modal` default. */
function useLayout(layout: "bottomSheet" | "modal"): void {
  const isSmall = layout === "bottomSheet";
  vi.stubGlobal("matchMedia", (query: string): Partial<MediaQueryList> => ({
    matches: query.includes("max-width") ? isSmall : false,
    media: query,
    addEventListener: () => {
      // Layout is fixed for the duration of a test.
    },
    removeEventListener: () => {
      // Mirror of `addEventListener`.
    },
  }));
}

function renderIntro(props: Partial<React.ComponentProps<typeof SessionIntroScreen>> = {}) {
  return render(
    <StudioVaaiUiProvider locale="en">
      <DefaultFlowSheetMount open onOpenChange={vi.fn<(open: boolean) => void>()}>
        <ErrorProvider
          value={{
            error: undefined,
            setReason: vi.fn<(reason: InteractionReason) => void>(),
            clearReason: vi.fn<() => void>(),
          }}
        >
          <SessionIntroScreen
            onConsent={vi.fn<() => void>()}
            onTakePhoto={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
            productName="Test Product"
            sizeLabel="M"
            hideConsent={false}
            consented={false}
            onConsentChange={vi.fn<(checked: boolean) => void>()}
            onConsentRequired={vi.fn<() => void>()}
            {...props}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
}

describe("SessionIntroScreen photo-facts disclosure", () => {
  beforeEach(() => {
    useLayout("modal");
  });

  it("reveals the photo-handling facts when opened, with the consent checkbox present", () => {
    renderIntro();
    const toggle = screen.getByRole("button", { name: /What happens to your photo/i });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // The facts must be reachable, not merely present-but-inert.
    const facts = screen.getByText(/Your photo is only used for the try-on/i);
    expect(facts).toBeTruthy();
    expect(facts.closest("[inert]")).toBeNull();
  });
});
