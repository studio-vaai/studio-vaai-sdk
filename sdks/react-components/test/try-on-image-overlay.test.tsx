// @vitest-environment jsdom

import type { TryOnProvenance } from "@studio-vaai/js-client";
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";
import type {
  StudioVaaiUiComponentOverrides,
  TryOnImageOverlayProps,
} from "../src/studio-vaai-ui-component-overrides-types.js";

import { TryOnViewScreen } from "../src/batteries/try-on-view-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { testProduct } from "./helpers.js";

const provenance: TryOnProvenance = {
  bodyId: "body-1",
  productId: "product-1",
  pieceId: "piece-m",
  sizeSlug: "m",
  manifestHash: "19cc3f79".padEnd(64, "0"),
  bakeHash: "7a1c2b3d".padEnd(64, "0"),
  createdAt: "2026-10-07T10:00:00Z",
};
const slides = [
  {
    src: "https://example.com/render.jpg",
    attributes: { colorway: "black", size: "m" },
    tryOnId: "try-on-1",
    provenance,
  },
] as const;

const resulting: DefaultRootViewModel = {
  phase: "product",
  productPhase: "active",
  variant: "selected",
  recommendation: "visible",
  tryOnPipeline: "resulting",
  canStartTryOn: false,
};

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

function renderView(components?: StudioVaaiUiComponentOverrides): ReturnType<typeof render> {
  return render(
    <StudioVaaiUiProvider locale="en" {...(components === undefined ? {} : { components })}>
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
            selection={{ colorway: "black", size: "m" }}
            vm={resulting}
            carouselSlides={slides}
            initialSlideIndex={0}
            onBack={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
            onAddToCart={vi.fn<(attributes: Record<string, string>) => void>()}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
}

/** The screen's markup with React's per-render ids (`_r_4_`) blanked, so two renders compare. */
function screenMarkup(): string {
  return document.body.innerHTML.replaceAll(/_[rR]_[0-9a-zA-Z]+_/g, "_id_");
}

/** The hero frame: the nearest ancestor of the render's `<img>` that also holds the overlay. */
function frameOf(overlay: Element): HTMLElement | null {
  let node = document.querySelector('img[src="https://example.com/render.jpg"]')?.parentElement;
  while (node !== null && node !== undefined && !node.contains(overlay)) {
    node = node.parentElement;
  }
  return node ?? null;
}

describe("TryOnImageOverlay slot", () => {
  afterEach(cleanup);

  it("mounts nothing by default", () => {
    renderView();
    expect(document.querySelector("[data-studio-vaai='try-on-image-overlay']")).toBeNull();
  });

  it("floats the host's overlay over the render without touching the rest of the screen", () => {
    renderView();
    const without = screenMarkup();
    cleanup();

    const seen: TryOnImageOverlayProps[] = [];
    function Label(props: TryOnImageOverlayProps) {
      seen.push(props);
      return <span data-testid="label">{props.provenance?.bakeHash}</span>;
    }
    renderView({ TryOnImageOverlay: Label });

    const overlay = document.querySelector("[data-studio-vaai='try-on-image-overlay']");
    expect(overlay).not.toBeNull();
    // Out of flow, over the photo's top-left corner, transparent to pointer events itself.
    expect(overlay?.className).toContain("sv:absolute");
    expect(overlay?.className).toContain("sv:pointer-events-none");
    expect(overlay?.className).toContain("sv:top-2");
    expect(overlay?.className).toContain("sv:left-2");
    // Pinned inside the photo's own frame, not the dialog: it moves with the image.
    const frame = overlay === null ? null : frameOf(overlay);
    expect(frame?.getAttribute("role")).not.toBe("dialog");
    expect(frame?.querySelector("img")).not.toBeNull();
    // The slide's identity and provenance reach the host.
    expect(seen.at(-1)).toEqual({
      tryOnId: "try-on-1",
      attributes: { colorway: "black", size: "m" },
      provenance,
    });
    // Everything else is byte-identical: the overlay is the only addition.
    overlay?.remove();
    expect(screenMarkup()).toBe(without);
  });
});
