// @vitest-environment jsdom

import type { DefaultRootViewModel } from "@studio-vaai/react-headless";
import type { ComponentProps } from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { TryOnViewScreen } from "../src/batteries/try-on-view-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { testFitAnchors, testProduct, testRecommendation } from "./helpers.js";

const selection = { colorway: "black", size: "m" } as const;

const vmResulting: DefaultRootViewModel = {
  phase: "product",
  productPhase: "active",
  variant: "selected",
  recommendation: "visible",
  recommendationData: testRecommendation,
  tryOnPipeline: "resulting",
  canStartTryOn: false,
};

const slides = [
  { src: "https://example.com/m.jpg", attributes: selection, fitAnchors: testFitAnchors },
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

/**
 * jsdom ships no `matchMedia`, and without one `ResponsiveProvider` falls through to its
 * `modal` default — so every assertion here would silently exercise the desktop branch.
 * Stub it so each block states which layout it means to test.
 */
function useLayout(layout: "bottomSheet" | "modal"): void {
  const isSmall = layout === "bottomSheet";
  vi.stubGlobal("matchMedia", (query: string): Partial<MediaQueryList> => ({
    matches: query.includes("max-width") ? isSmall : false,
    media: query,
    addEventListener: () => {
      // No layout changes mid-test; nothing to notify.
    },
    removeEventListener: () => {
      // Mirror of `addEventListener` above.
    },
  }));
}

function renderFitUi(
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
            vm={vmResulting}
            fitIntelligence
            carouselSlides={slides}
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

/** The callout overlay. Queried off `document` because the sheet portals into `document.body`. */
function calloutLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-studio-vaai="try-on-fit-callouts"]');
}

/** Opens the collapsed size/color section the way a shopper does — via the primary CTA. */
function sizeChip(label: string): HTMLElement {
  const found = screen
    .getAllByRole("button")
    .find((b) => new RegExp(`^${label}\\b`).test(b.textContent ?? ""));
  if (found === undefined) {
    throw new Error(`no size chip for ${label}`);
  }
  return found;
}

function selectedSizeLabel(): string {
  return (
    screen
      .getByText(/^Size:/)
      .textContent?.replace("Size:", "")
      .trim() ?? ""
  );
}

function openPicker(): void {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Try another size or color" }));
  });
}

describe("TryOnViewScreen (fit intelligence, bottom sheet)", () => {
  beforeEach(() => {
    useLayout("bottomSheet");
  });

  it("names the shown variant in the header subtitle", () => {
    renderFitUi();
    expect(screen.getByText("Size M · Schwarz")).toBeTruthy();
  });

  it("shows the fit score for the size on screen", () => {
    renderFitUi();
    // `m` scores 97 in the fixture.
    expect(screen.getByText("97%")).toBeTruthy();
  });

  it("puts the price in the add-to-bag link when the host supplies one", () => {
    renderFitUi({ priceLabel: "€89" });
    expect(screen.getByRole("button", { name: "Add M to bag (€89)" })).toBeTruthy();
  });

  it("falls back to size-only bag copy without a price", () => {
    renderFitUi();
    expect(screen.getByRole("button", { name: "Add M to bag" })).toBeTruthy();
  });

  it("opens the size/color picker from the primary CTA and swaps the CTA to the commit action", () => {
    renderFitUi();
    openPicker();
    expect(screen.getByRole("button", { name: "Try on M in Schwarz" })).toBeTruthy();
  });

  it("stages a size pick without moving the hero, then commits it on the CTA", () => {
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    const onShownAttributesChange = vi.fn<(attributes: Record<string, string>) => void>();
    renderFitUi({ onSelectVariant, onShownAttributesChange });
    openPicker();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L" }));
    });
    // Staged only: the visible try-on is still the M render, so nothing was requested yet.
    expect(onSelectVariant).not.toHaveBeenCalled();
    expect(onShownAttributesChange).toHaveBeenLastCalledWith({ colorway: "black", size: "m" });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Try on L in Schwarz" }));
    });
    expect(onSelectVariant).toHaveBeenCalledWith({ colorway: "black", size: "l" });
  });

  it("switches to an existing render instead of requesting one", () => {
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    const onShownAttributesChange = vi.fn<(attributes: Record<string, string>) => void>();
    renderFitUi({
      onSelectVariant,
      onShownAttributesChange,
      carouselSlides: [
        ...slides,
        { src: "https://example.com/l.jpg", attributes: { colorway: "black", size: "l" } },
      ],
    });
    openPicker();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Try on L in Schwarz" }));
    });

    expect(onSelectVariant).not.toHaveBeenCalled();
    expect(onShownAttributesChange).toHaveBeenLastCalledWith({ colorway: "black", size: "l" });
  });

  it("does not block a loose size — looseness is a quality verdict, not a gate", () => {
    // `docs/fit-gating.md`: shoulder-anchored garments "only gate too-small — an oversized tee
    // stays on, so looseness is a quality verdict". The outlook's big end therefore refuses
    // nothing; what bounds a waist-anchored garment above is the server's `gate`, below.
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderFitUi({
      onSelectVariant,
      vm: {
        ...vmResulting,
        recommendationData: {
          ...testRecommendation,
          recommendations: testRecommendation.recommendations.map((r) =>
            r.size === "xl" ? { ...r, fit: "too_loose" as const } : r,
          ),
        },
      },
    });
    openPicker();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "XL" }));
    });
    const cta = screen.getByRole("button", { name: "Try on XL in Schwarz" });
    expect(cta.hasAttribute("disabled")).toBe(false);
    act(() => {
      fireEvent.click(cta);
    });
    expect(onSelectVariant).toHaveBeenCalledWith({ colorway: "black", size: "xl" });
  });

  it("marks gate-rejected sizes for assistive tech and blocks committing them", () => {
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderFitUi({
      onSelectVariant,
      vm: {
        ...vmResulting,
        recommendationData: {
          ...testRecommendation,
          recommendations: testRecommendation.recommendations.map((r) =>
            r.size === "xl" ? { ...r, gate: "too_large" } : r,
          ),
        },
      },
    });
    openPicker();

    const gated = screen.getByRole("button", { name: "XL (likely too large)" });
    act(() => {
      fireEvent.click(gated);
    });

    const cta = screen.getByRole("button", { name: "Try on XL in Schwarz" });
    expect(cta.hasAttribute("disabled")).toBe(true);
    act(() => {
      fireEvent.click(cta);
    });
    expect(onSelectVariant).not.toHaveBeenCalled();
  });

  it("releases a staged gated size when the shopper taps back to the size on screen", () => {
    renderFitUi({
      vm: {
        ...vmResulting,
        recommendationData: {
          ...testRecommendation,
          recommendations: testRecommendation.recommendations.map((r) =>
            r.size === "xl" ? { ...r, gate: "too_large" } : r,
          ),
        },
      },
    });
    openPicker();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "XL (likely too large)" }));
    });
    expect(screen.getByRole("button", { name: "Try on XL in Schwarz" })).toBeTruthy();

    // Back to the size the visible render already shows. That combination HAS a slide, so it
    // moves the carousel rather than staging — and because the target is the slide already on
    // screen, nothing about the active attributes changes. The staged gated size must still be
    // released here, or the picker stays latched on XL with its CTA disabled and the shopper
    // has no way back short of closing the sheet.
    const onScreen = screen.getAllByRole("button").find((b) => /^M\b/.test(b.textContent ?? ""));
    expect(onScreen).toBeTruthy();
    act(() => {
      fireEvent.click(onScreen!);
    });

    expect(screen.queryByRole("button", { name: "Try on XL in Schwarz" })).toBeNull();
  });

  it("lets every size be selected, in any order, gated or not", () => {
    // The picker must never strand the shopper on a size they cannot leave. Two distinct code
    // paths decide what a tap does — a combination WITH a render moves the carousel, one without
    // it stages a draft — and both have to end with the tapped size selected. XL is gated here,
    // and M is the size the only slide already shows, so this walk covers both paths plus the
    // gated chip in every order the shopper could reach them.
    renderFitUi({
      vm: {
        ...vmResulting,
        recommendationData: {
          ...testRecommendation,
          recommendations: testRecommendation.recommendations.map((r) =>
            r.size === "xl" ? { ...r, gate: "too_large" } : r,
          ),
        },
      },
    });
    openPicker();

    // Forwards, backwards, and back onto the slide's own size — the sequence that used to latch.
    for (const label of ["XS", "S", "M", "L", "XL", "L", "M", "XL", "M", "XS"]) {
      act(() => {
        fireEvent.click(sizeChip(label));
      });
      expect(selectedSizeLabel()).toBe(label);
      expect(sizeChip(label).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("reveals the image callouts only while the fit score is expanded", () => {
    renderFitUi();

    // Mounted from the start (so its geometry stays measured) but hidden and inert.
    expect(calloutLayer()?.dataset.svVisible).toBeUndefined();
    expect(calloutLayer()?.hasAttribute("inert")).toBe(true);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show or hide fit score details" }));
    });
    expect(calloutLayer()?.dataset.svVisible).toBe("");
    expect(calloutLayer()?.hasAttribute("inert")).toBe(false);
  });

  it("refuses a sold-out size and says why instead of staging it", () => {
    const soldOutProduct = {
      ...testProduct,
      attributeMetadata: {
        ...testProduct.attributeMetadata,
        sizes: testProduct.attributeMetadata.sizes.map((s) =>
          s.slug === "l" ? { ...s, soldOut: true } : s,
        ),
      },
    };
    renderFitUi({ product: soldOutProduct });
    openPicker();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L (sold out)" }));
    });

    expect(screen.getByText("Size L is currently sold out.")).toBeTruthy();
    // The draft never moved, so the commit CTA still names the size on screen.
    expect(screen.getByRole("button", { name: "Try on M in Schwarz" })).toBeTruthy();
  });

  it("states a failed render inline and offers a retry without leaving the screen", () => {
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderFitUi({
      onSelectVariant,
      vm: { ...vmResulting, tryOnPipeline: "error" },
      lastTryOnFailure: { reason: "render_failed", requestedSize: "l", recommendedSize: "m" },
    });

    expect(screen.getByText("Try-on in L failed")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    // The retry re-requests the size that FAILED, not the one still on the hero — a failure
    // resets the draft back to the visible render, so `l` here rather than `m`.
    expect(onSelectVariant).toHaveBeenCalledWith({ colorway: "black", size: "l" });
  });

  it("swaps the fit-score ribbon for a retryable bar when the recommendation failed", () => {
    const onRetryRecommendation = vi.fn<() => void>();
    renderFitUi({
      onRetryRecommendation,
      vm: { ...vmResulting, recommendation: "error", recommendationData: null },
    });

    expect(screen.getByText("Fit score unavailable")).toBeTruthy();
    // The picker survives a failed recommendation — only the scoring on top of it is lost.
    expect(screen.getByRole("button", { name: "Try another size or color" })).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Reload fit score" }));
    });
    expect(onRetryRecommendation).toHaveBeenCalledOnce();
  });

  it("does not render the fit UI when the flag is off", () => {
    renderFitUi({ fitIntelligence: false });
    expect(screen.queryByText("Fit Score")).toBeNull();
    expect(screen.getByRole("button", { name: "Add M to bag" })).toBeTruthy();
  });
});

describe("TryOnViewScreen (fit intelligence, modal)", () => {
  beforeEach(() => {
    useLayout("modal");
  });

  it("opens with the picker already expanded beside the hero", () => {
    renderFitUi();
    // No "open the picker" step on desktop — the commit CTA is there from the start.
    expect(screen.getByRole("button", { name: "Try on M in Schwarz" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "L" })).toBeTruthy();
  });

  it("keeps the commit CTA live for the pick already on screen — the click is a no-op", () => {
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderFitUi({ onSelectVariant });
    // Enabled even though nothing has changed: a greyed-out primary CTA on the resting modal
    // is indistinguishable from a broken screen. Committing the shown pick resolves to the
    // slide already displayed, so it costs no pipeline work.
    const cta = screen.getByRole("button", { name: "Try on M in Schwarz" });
    expect(cta.hasAttribute("disabled")).toBe(false);
    act(() => {
      fireEvent.click(cta);
    });
    expect(onSelectVariant).not.toHaveBeenCalled();

    // A genuinely different pick still reaches the host.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "L" }));
    });
    const changed = screen.getByRole("button", { name: "Try on L in Schwarz" });
    expect(changed.hasAttribute("disabled")).toBe(false);
    act(() => {
      fireEvent.click(changed);
    });
    expect(onSelectVariant).toHaveBeenCalledWith({ colorway: "black", size: "l" });
  });
});

/** Queried off `document`: the sheet and the dialog both portal into `document.body`. */
function shellRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-studio-vaai="surface-shell"]');
}

/**
 * The shell surface belongs to the flow, not to a screen. The try-on step used to repaint the
 * shell root, which tinted the panel's own rounded corners square — so this one step looked
 * unlike every other, and unlike itself with the flag off.
 */
describe("TryOnViewScreen shell chrome", () => {
  for (const layout of ["bottomSheet", "modal"] as const) {
    for (const fitIntelligence of [true, false]) {
      it(`leaves the shell surface alone (${layout}, flag ${fitIntelligence ? "on" : "off"})`, () => {
        useLayout(layout);
        renderFitUi({ fitIntelligence });
        // Any `bg-…` on the shell root paints over the panel, corners included. The panel owns
        // the surface; the screen owns what sits on it.
        expect(shellRoot()?.className).not.toMatch(/\bsv:bg-/);
      });
    }
  }
});
