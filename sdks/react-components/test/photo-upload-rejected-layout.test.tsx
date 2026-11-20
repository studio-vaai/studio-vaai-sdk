// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { PhotoUploadRejectedScreen } from "../src/batteries/photo-upload-rejected-screen.js";
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

function renderRejected() {
  return render(
    <StudioVaaiUiProvider locale="en">
      <DefaultFlowSheetMount open onOpenChange={vi.fn<(open: boolean) => void>()}>
        <ErrorProvider
          value={{
            error: {
              message: "Please use a photo that shows you from head to toe.",
              kind: "failure",
            },
            setReason: vi.fn<(reason: InteractionReason) => void>(),
            clearReason: vi.fn<() => void>(),
          }}
        >
          <PhotoUploadRejectedScreen
            previewSrc="blob:rejected"
            onRetry={vi.fn<() => void>()}
            onGuideToGreatPhoto={vi.fn<() => void>()}
            onBack={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
}

describe("PhotoUploadRejectedScreen layout", () => {
  // A square or landscape photo fills its column's whole width. With the message centred beside
  // it and the actions in a footer of their own, the photo's shape decided where everything
  // else sat, and the message ended up pressed against the photo.
  it("stacks the message and both actions in one block beside the photo in the modal", () => {
    useLayout("modal");
    renderRejected();

    const message = screen.getByRole("alert");
    const retry = screen.getByRole("button", { name: "Use a different photo" });
    const guide = screen.getByRole("button", { name: "Guide to a great photo" });

    expect([...(message.parentElement?.children ?? [])]).toEqual([message, retry, guide]);
    expect(document.querySelector('[data-studio-vaai="actions-section"]')).toBeNull();
  });

  it("keeps the message with the footer actions on the sheet", () => {
    useLayout("bottomSheet");
    renderRejected();

    const message = screen.getByRole("alert");
    const actions = document.querySelector('[data-studio-vaai="actions-section"]');

    expect(actions).not.toBeNull();
    expect(actions?.parentElement).toBe(message.parentElement);
  });
});
