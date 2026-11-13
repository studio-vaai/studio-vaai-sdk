// @vitest-environment jsdom

import type { DefaultRootViewModel } from "@studio-vaai/react-headless";
import type { ComponentProps } from "react";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { TryOnViewScreen } from "../src/batteries/try-on-view-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { testProduct } from "./helpers.js";

const selection = { colorway: "black", size: "m" } as const;

const productVmResulting: DefaultRootViewModel = {
  phase: "product",
  productPhase: "active",
  variant: "selected",
  recommendation: "visible",
  tryOnPipeline: "resulting",
  canStartTryOn: false,
};

const carouselSlides = [
  { src: "https://example.com/a.jpg", attributes: { colorway: "black", size: "s" } },
  { src: "https://example.com/b.jpg", attributes: { colorway: "black", size: "l" } },
] as const;

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

function renderTryOnView(
  props: Partial<ComponentProps<typeof TryOnViewScreen>> = {},
): ReturnType<typeof render> {
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
          <TryOnViewScreen
            product={testProduct}
            selection={selection}
            vm={productVmResulting}
            carouselSlides={carouselSlides}
            initialSlideIndex={0}
            onBack={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
            onAddToCart={vi.fn<(attributes: typeof selection) => void>()}
            {...props}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
}

describe("TryOnViewScreen", () => {
  // These cases query the document directly, so a render the previous one left mounted would
  // be what they find. Testing Library auto-cleans only under `globals: true`.
  afterEach(cleanup);

  it("mirrors the shown render's attributes via onShownAttributesChange", () => {
    const onShownAttributesChange = vi.fn<(attributes: typeof selection) => void>();
    renderTryOnView({ onShownAttributesChange });

    expect(onShownAttributesChange).toHaveBeenCalledWith({ colorway: "black", size: "s" });

    // The size/color picker is the ONLY control over what is on the hero. Committing a size
    // that already has a render switches to it without asking the host for anything.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Try on L in Schwarz" }));
    });

    expect(onShownAttributesChange).toHaveBeenLastCalledWith({ colorway: "black", size: "l" });
  });

  it("offers no gallery navigation — no swipe track, arrows, or dots", () => {
    renderTryOnView();
    expect(screen.queryByLabelText("Your try-ons")).toBeNull();
    expect(document.querySelector('[data-studio-vaai="try-on-tried-variants"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous image" })).toBeNull();
    // Exactly one render on screen, not a track of every variant tried so far.
    expect(document.querySelectorAll("img[src^='https://example.com/']").length).toBe(1);
  });

  it("passes the shown render's attributes to onAddToCart", () => {
    const onAddToCart = vi.fn<(attributes: typeof selection) => void>();
    renderTryOnView({
      onAddToCart,
      initialSlideIndex: 1,
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Add L to bag/i }));
    });

    expect(onAddToCart).toHaveBeenCalledWith({ colorway: "black", size: "l" });
  });

  it("shows an already-generated size the moment its chip is picked", () => {
    // Nothing to generate and nothing to confirm — asking the shopper to press the CTA to
    // reveal a picture already in hand is a step that buys nothing. "L" has a slide.
    const onShownAttributesChange = vi.fn<(attributes: typeof selection) => void>();
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderTryOnView({ onShownAttributesChange, onSelectVariant });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L" }));
    });

    expect(onShownAttributesChange).toHaveBeenLastCalledWith({ colorway: "black", size: "l" });
    // And no pipeline work: the host is never asked to remake what it already made.
    expect(onSelectVariant).not.toHaveBeenCalled();
  });

  it("still stages a size with NO render until the CTA commits it", () => {
    // The counterpart to the case above: generating costs real pipeline work, so an unrendered
    // variant waits for a deliberate commit rather than firing off a render per chip tap.
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderTryOnView({ onSelectVariant });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "XL" }));
    });
    expect(onSelectVariant).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Try on XL in Schwarz" }));
    });
    expect(onSelectVariant).toHaveBeenCalledWith({ colorway: "black", size: "xl" });
  });
});

function struck(label: string): boolean {
  return Array.from(document.querySelectorAll("button")).some(
    (b) => b.textContent === label && b.className.includes("line-through"),
  );
}

describe("TryOnViewScreen gate parity", () => {
  afterEach(cleanup);

  // The size step and the try-on view are one tap apart and must refuse the same sizes. A
  // server rejection is the only gate source that survives a missing recommendation — exactly
  // when the shopper has nothing else to go on — so this screen has to honour it too.
  it("strikes a size the server already refused, and cascades below it", () => {
    renderTryOnView({
      lastTryOnFailure: { reason: "garment_too_small", requestedSize: "m", recommendedSize: "l" },
    });

    // M was refused outright; XS cannot close either if M cannot.
    expect(struck("M")).toBe(true);
    expect(struck("XS")).toBe(true);
    // S is also gated by the cascade, but it is the SELECTED chip here and selection styling
    // outranks the strike — the same precedence the size step draws.
    // Nothing above a too-small verdict is implicated.
    expect(struck("L")).toBe(false);
    expect(struck("XL")).toBe(false);
  });
});

function banner(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-studio-vaai="try-on-render-failed"]');
}

describe("TryOnViewScreen stale render failure", () => {
  afterEach(cleanup);

  const erroring: DefaultRootViewModel = { ...productVmResulting, tryOnPipeline: "error" };
  const failedOnS = { reason: "render_failed", requestedSize: "s", recommendedSize: "" };

  it("reports the failure while the size that failed is the one on screen", () => {
    // Slide 0 is size S, so the failed variant is exactly what the shopper is looking at.
    renderTryOnView({ vm: erroring, lastTryOnFailure: failedOnS });
    expect(banner()?.textContent).toMatch(/S/);
  });

  // The state the MACHINE actually produces. `error` is only reachable from `requesting`'s
  // `onError`, which records no `lastTryOnFailure` — so the two tests above, which pass one in
  // alongside `error`, describe a combination that never occurs in the flow. They still pin real
  // intent, but the ordinary render failure looked like this, and it was broken in three ways at
  // once because the size was read off whatever the shopper was currently looking at.
  describe("without a machine-recorded failure (the ordinary render-failure path)", () => {
    // Attempted XL; slide 0 on the hero is S.
    const attemptingXl = { colorway: "black", size: "xl" } as const;

    it("names the size that was attempted, not the one on the hero", () => {
      const view = renderTryOnView({
        vm: { ...productVmResulting, tryOnPipeline: "requesting" },
        selection: attemptingXl,
      });
      view.rerender(
        <StudioVaaiUiProvider locale="en">
          <DefaultFlowSheetMount open onOpenChange={vi.fn<(open: boolean) => void>()}>
            <ErrorProvider
              value={{
                error: undefined,
                setReason: vi.fn<(reason: InteractionReason) => void>(),
                clearReason: vi.fn<() => void>(),
              }}
            >
              <TryOnViewScreen
                product={testProduct}
                selection={attemptingXl}
                vm={erroring}
                carouselSlides={carouselSlides}
                initialSlideIndex={0}
                onBack={vi.fn<() => void>()}
                onClose={vi.fn<() => void>()}
                onAddToCart={vi.fn<(attributes: typeof selection) => void>()}
              />
            </ErrorProvider>
          </DefaultFlowSheetMount>
        </StudioVaaiUiProvider>,
      );
      const text = banner()?.textContent ?? "";
      expect(text).toMatch(/XL/);
      // S is slide 0 — the size it used to name, which the shopper never tried.
      expect(text).not.toMatch(/\bS failed\b/);
    });

    it("does not rename itself when the shopper taps a size without trying it", () => {
      renderTryOnView({ vm: erroring, selection: attemptingXl });
      const before = banner()?.textContent ?? "";

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "L" }));
      });

      // Either it is gone (the shopper moved on) or it still describes the same attempt — what
      // it must never do is relabel itself as a verdict on L, which was never requested.
      const after = banner()?.textContent;
      if (after !== undefined && after !== null) {
        expect(after).toBe(before);
        expect(after).not.toMatch(/\bL failed\b/);
      }
    });
  });

  it("drops the banner once the shopper stages a different size", () => {
    renderTryOnView({ vm: erroring, lastTryOnFailure: failedOnS });
    expect(banner()).not.toBeNull();

    // Staging L is the shopper moving on. Leaving "Try-on in S failed" up next to a picker
    // showing L reads as a verdict on L — the reported bug.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L" }));
    });

    expect(banner()).toBeNull();
  });
});
