// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PhotoCaptureScreenStatus } from "../src/batteries/photo-capture-screen.js";

import { PhotoCaptureScreen } from "../src/batteries/photo-capture-screen.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";

class ResizeObserverMock {
  observe(): void {
    // Preview geometry is fixed in this test.
    void this;
  }
  unobserve(): void {
    // No observed geometry to release.
    void this;
  }
  disconnect(): void {
    // No observed geometry to release.
    void this;
  }
}

function renderCapture(status: PhotoCaptureScreenStatus, mobile: boolean) {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    addEventListener: vi.fn<MediaQueryList["addEventListener"]>(),
    removeEventListener: vi.fn<MediaQueryList["removeEventListener"]>(),
  }));
  const retry = vi.fn<() => void>();
  render(
    <StudioVaaiUiProvider locale="en">
      <DefaultFlowSheetMount open onOpenChange={vi.fn<(open: boolean) => void>()}>
        <PhotoCaptureScreen
          status={status}
          previewSrc="/sample-photo.jpg"
          onStartSelfTimer={vi.fn<() => void>()}
          onRetry={retry}
          onUploadFromLibrary={vi.fn<() => void>()}
          onBack={vi.fn<() => void>()}
          onClose={vi.fn<() => void>()}
        />
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
  return retry;
}

describe.each([false, true])("camera actions (mobile: %s)", (mobile) => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not offer retry or library actions while a captured photo is uploading", () => {
    renderCapture("uploading", mobile);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload a photo from your library/i })).toBeNull();
  });

  it.each(["denied", "unavailable", "error"] as const)(
    "keeps retry functional for %s camera access",
    (status) => {
      const retry = renderCapture(status, mobile);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(retry).toHaveBeenCalledOnce();
    },
  );
});
