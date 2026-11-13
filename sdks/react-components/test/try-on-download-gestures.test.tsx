// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { TryOnViewScreen } from "../src/batteries/try-on-view-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { testProduct } from "./helpers.js";

const slides = [
  { src: "https://example.com/result.jpg", attributes: { colorway: "black", size: "m" } },
];

function dispatchTouch(
  target: Element,
  type: string,
  ...points: { clientX: number; clientY: number }[]
): TouchEvent {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Object.assign(points, { item: (index: number) => points[index] ?? null }),
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function renderResult(resultSlides = slides) {
  const onOpenChange = vi.fn<() => void>();
  render(
    <StudioVaaiUiProvider locale="en">
      <DefaultFlowSheetMount open onOpenChange={onOpenChange}>
        <ErrorProvider
          value={{
            error: undefined,
            setReason: vi.fn<(reason: InteractionReason) => void>(),
            clearReason: vi.fn<() => void>(),
          }}
        >
          <TryOnViewScreen
            product={testProduct}
            selection={{ colorway: "black", size: "m" }}
            vm={{
              phase: "product",
              productPhase: "active",
              variant: "selected",
              recommendation: "visible",
              tryOnPipeline: "resulting",
              canStartTryOn: false,
            }}
            fitIntelligence={false}
            carouselSlides={resultSlides}
            onBack={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
            onAddToCart={vi.fn<(attributes: Record<string, string>) => void>()}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
  const button = screen.getByRole("button", { name: "Download image" });
  const image = document.querySelector<HTMLImageElement>(
    "img[src='https://example.com/result.jpg']",
  );
  if (image === null) {
    throw new Error("Result image is missing");
  }
  const hitTest = vi.fn<() => Element>(() => button);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  return { button, image, hitTest, onOpenChange };
}

describe("try-on download touch gestures", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          void this;
        }
        disconnect() {
          void this;
        }
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 768px)",
      media: query,
      addEventListener: vi.fn<() => void>(),
      removeEventListener: vi.fn<() => void>(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("does not let the sheet cancel finger jitter on Download", () => {
    const { button, onOpenChange } = renderResult();
    dispatchTouch(button, "touchstart", { clientX: 100, clientY: 100 });
    const move = dispatchTouch(button, "touchmove", { clientX: 100, clientY: 102 });
    expect(move.defaultPrevented).toBe(false);
    dispatchTouch(button, "touchend");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("prepares the iPhone image before the tap and shares without a download navigation", async () => {
    let finishFetch: ((response: Response) => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- hold the network response until after the initial render
    const response = new Promise<Response>((resolve) => {
      finishFetch = resolve;
    });
    const fetchImage = vi.fn<typeof fetch>().mockReturnValue(response);
    const share = vi.fn<Navigator["share"]>(async () => {
      await Promise.resolve();
    });
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/154.0 Mobile Safari/604.1",
      share,
      canShare: vi.fn<Navigator["canShare"]>().mockReturnValue(true),
    });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const open = vi.spyOn(globalThis, "open");
    const { button, image } = renderResult();
    expect(button.hasAttribute("disabled")).toBe(true);

    finishFetch?.(new Response("image", { headers: { "Content-Type": "image/jpeg" } }));
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(button);
    // The share call happens in the click, before yielding to another fetch or task.
    expect(share).toHaveBeenCalledOnce();
    const file = share.mock.calls[0]?.[0]?.files?.[0];
    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe("image/jpeg");
    expect(file?.name).toBe("test-product-m.jpg");
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(button);
    expect(share).toHaveBeenCalledTimes(2);
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(image.isConnected).toBe(true);
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  it("keeps the iPhone result open when the native share sheet is cancelled", async () => {
    const share = vi
      .fn<Navigator["share"]>()
      .mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    vi.stubGlobal("navigator", {
      userAgent: "iPhone",
      share,
      canShare: vi.fn<Navigator["canShare"]>().mockReturnValue(true),
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("image", { headers: { "Content-Type": "image/jpeg" } })),
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const open = vi.spyOn(globalThis, "open");
    const { button, image, onOpenChange } = renderResult();
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    expect(share).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(image.isConnected).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not share an old image when its fetch finishes after changing results", async () => {
    let finishOldFetch: ((response: Response) => void) | undefined;
    // oxlint-disable-next-line promise/avoid-new -- deliver the old image after the new image is ready
    const oldResponse = new Promise<Response>((resolve) => {
      finishOldFetch = resolve;
    });
    const fetchImage = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(
        new Response("new image", { headers: { "Content-Type": "image/jpeg" } }),
      );
    const share = vi.fn<Navigator["share"]>(async () => {
      await Promise.resolve();
    });
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal("navigator", {
      userAgent: "iPhone",
      share,
      canShare: vi.fn<Navigator["canShare"]>().mockReturnValue(true),
    });
    const { button } = renderResult([
      ...slides,
      { src: "https://example.com/new-result.jpg", attributes: { colorway: "black", size: "l" } },
    ]);
    const otherResult = document.querySelector(
      '[data-studio-vaai="try-on-tried-variants"] button[aria-pressed="false"]',
    );
    if (otherResult === null) {
      throw new Error("Second result is missing");
    }
    fireEvent.click(otherResult);
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    await act(async () => {
      finishOldFetch?.(new Response("old image", { headers: { "Content-Type": "image/jpeg" } }));
    });
    fireEvent.click(button);
    expect(share.mock.calls[0]?.[0]?.files?.[0]?.name).toBe("test-product-l.jpg");
    expect(fetchImage.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  it("does not cancel touch jitter or pinch zoom after repeated downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => new Response("image")),
    );
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = vi.fn<() => string>(() => "blob:download");
        static override revokeObjectURL = vi.fn<() => void>();
      },
    );
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(vi.fn<() => void>());
    const { button, image, hitTest, onOpenChange } = renderResult();

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      hitTest.mockReturnValue(button);
      dispatchTouch(button, "touchstart", { clientX: 100, clientY: 100 });
      dispatchTouch(button, "touchend");
      fireEvent.click(button);
      // oxlint-disable-next-line no-await-in-loop -- exercise successive downloads on the same mounted image
      await waitFor(() => {
        expect(download).toHaveBeenCalledTimes(attempt);
        expect(button.hasAttribute("disabled")).toBe(false);
      });

      hitTest.mockReturnValue(image);
      dispatchTouch(image, "touchstart", { clientX: 100, clientY: 100 });
      const move = dispatchTouch(image, "touchmove", { clientX: 100, clientY: 102 });
      expect(move.defaultPrevented).toBe(false);
      dispatchTouch(image, "touchend");
    }

    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 300));
    dispatchTouch(
      image,
      "touchstart",
      { clientX: 50, clientY: 100 },
      { clientX: 150, clientY: 100 },
    );
    const pinch = dispatchTouch(
      image,
      "touchmove",
      { clientX: 25, clientY: 100 },
      { clientX: 175, clientY: 100 },
    );
    expect(pinch.defaultPrevented).toBe(true);
    expect(document.querySelector(".sv-image-zoom-portal--pinching")).not.toBeNull();
    dispatchTouch(image, "touchend");
    expect(document.querySelector(".sv-image-zoom-portal--springing")).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
