// @vitest-environment jsdom

import type { DefaultRootViewModel } from "@studio-vaai/react-headless";
import type { ComponentProps } from "react";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { ProductOverviewScreen } from "../src/batteries/product-overview-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { testProduct } from "./helpers.js";

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

const vm: DefaultRootViewModel = {
  phase: "product",
  productPhase: "active",
  variant: "selected",
  recommendation: "visible",
  tryOnPipeline: "idle",
  canStartTryOn: true,
};

function renderOverview(
  props: Partial<ComponentProps<typeof ProductOverviewScreen>> = {},
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
          <ProductOverviewScreen
            product={testProduct}
            selection={{ colorway: "black", size: "s" }}
            vm={vm}
            heroImageSrc=""
            onSelectVariant={vi.fn<(selection: Record<string, string>) => void>()}
            onStartTryOn={vi.fn<() => void>()}
            onBack={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
            onUploadAnother={vi.fn<() => void>()}
            {...props}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
}

function note(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-studio-vaai="try-on-gate-note"]');
}

/**
 * The server rejects a try-on it cannot render (`garment_too_small` / `garment_too_large`).
 * When another size on the ladder is still tryable the note points there; the dead-end copy is
 * reserved for a refusal with genuinely nowhere to go.
 *
 * These cases used to assert the opposite, and the product fixture is exactly why that was
 * wrong: it is an `xs…xl` run, so "this style doesn't come any larger" was false for every
 * refusal below XL. The note derived its alternative from the server's suggestion alone —
 * absent or self-referential meant "dead end" — instead of consulting the ladder the picker
 * draws. On screen that printed the dead end at S with M, L and XL offered right beside it.
 */
describe("try-on gate failure note", () => {
  // `note()` queries the document, so a render the previous case left mounted is what it finds.
  // Testing Library auto-cleans only when vitest runs with `globals: true`; this file imports
  // its hooks explicitly, so the unmounts have to be asked for.
  afterEach(cleanup);

  // The rejection is a SERVER verdict, so it must surface on both paths. `fitIntelligence`
  // gates the fit-percentage layer (score ribbon, callouts, recommended chip) and nothing
  // about a failed try-on — a shopper on the plain flow gets the same dead end and needs the
  // same explanation.
  for (const fitIntelligence of [true, false]) {
    it(`shows only the size warning when the server suggests nothing usable (fitUi ${fitIntelligence ? "on" : "off"})`, () => {
      renderOverview({
        fitIntelligence,
        // `recommendedSize === requestedSize` is the server declining to name an alternative,
        // NOT evidence that none exists — M, L and XL are all still offered here.
        lastTryOnFailure: { reason: "garment_too_small", requestedSize: "s", recommendedSize: "s" },
      });

      const el = note();
      expect(el).not.toBeNull();
      expect(el?.textContent).toMatch(/too small for you/i);
      expect(el?.textContent).toBe("Size S is too small for you.");
      expect(el?.textContent).not.toMatch(/doesn't come any larger/i);
      // Announced, not silently painted — it answers a tap the shopper just made.
      expect(el?.getAttribute("role")).toBe("status");
      // A refused size is now gated like any other, so the note rides the axis pill the
      // reference draws rather than a separate coloured line under the picker.
      //
      // S itself is the SELECTED chip, and selection styling outranks the strike, so the
      // cascade is what is visible: XS cannot close either if S cannot, and it is struck.
      expect(document.querySelector('[data-sv-value="xs"]')?.className).toContain("line-through");
    });
  }

  it("shows only the size warning when a too-large refusal names nothing", () => {
    renderOverview({
      lastTryOnFailure: { reason: "garment_too_large", requestedSize: "s", recommendedSize: "" },
    });
    const text = note()?.textContent ?? "";
    expect(text).toMatch(/too large for you/i);
    expect(text).toBe("Size S is too large for you.");
    expect(text).not.toMatch(/doesn't come any smaller/i);
  });

  // The dead-end copy still has a job — it just has to be TRUE. These are the two refusals with
  // genuinely nowhere left to go on an `xs…xl` run.
  it("keeps the dead-end copy when the largest size is still too small", () => {
    renderOverview({
      lastTryOnFailure: { reason: "garment_too_small", requestedSize: "xl", recommendedSize: "" },
    });
    expect(note()?.textContent).toMatch(/doesn't come any larger/i);
  });

  it("keeps the dead-end copy when the smallest size is still too large", () => {
    renderOverview({
      lastTryOnFailure: { reason: "garment_too_large", requestedSize: "xs", recommendedSize: "" },
    });
    expect(note()?.textContent).toMatch(/doesn't come any smaller/i);
  });

  for (const fitIntelligence of [true, false]) {
    it(`temporarily hides the recommendation when the gate names one (fitUi ${fitIntelligence ? "on" : "off"})`, () => {
      renderOverview({
        fitIntelligence,
        lastTryOnFailure: { reason: "garment_too_small", requestedSize: "s", recommendedSize: "m" },
      });

      const el = note();
      expect(el?.textContent).toMatch(/too small/i);
      expect(el?.textContent).toBe("Size S is too small for you.");
      // Everything below the refused size remains struck while recommendations are hidden.
      expect(document.querySelector('[data-sv-value="xs"]')?.className).toContain("line-through");
    });
  }

  it("says nothing when no try-on was rejected", () => {
    renderOverview();
    expect(note()).toBeNull();
  });
});
