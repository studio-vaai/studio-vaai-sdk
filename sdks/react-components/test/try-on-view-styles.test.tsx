// @vitest-environment jsdom

import type { TryOnFlowProduct } from "@studio-vaai/js-machine";
import type { DefaultRootViewModel } from "@studio-vaai/react-headless";
import type { ComponentProps } from "react";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InteractionReason } from "../src/error/derive-error.js";

import { TryOnViewScreen } from "../src/batteries/try-on-view-screen.js";
import { ErrorProvider } from "../src/error/error-context.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { DefaultFlowSheetMount } from "../src/ui/default-flow-sheet-mount.js";
import { testProduct } from "./helpers.js";

// A blazer sold buttoned / unbuttoned: every size and colour exists in both styles, and the
// machine renders both styles of a pick together, so two slides differ ONLY by `template`.
const styledProduct: TryOnFlowProduct = {
  ...testProduct,
  variants: testProduct.variants.flatMap((v) => [
    { id: `${v.id}-buttoned-up`, attributes: { ...v.attributes, template: "buttoned-up" } },
    { id: `${v.id}-buttoned-down`, attributes: { ...v.attributes, template: "buttoned-down" } },
  ]),
  attributeMetadata: {
    ...testProduct.attributeMetadata,
    styles: [
      { slug: "buttoned-up", label: "Buttoned", glyph: "buttoned-up" },
      { slug: "buttoned-down", label: "Unbuttoned", glyph: "buttoned-down" },
    ],
  },
};
const selection = { colorway: "black", size: "m", template: "buttoned-up" } as const;
const slides = [
  {
    src: "https://example.com/up.jpg",
    attributes: { colorway: "black", size: "m", template: "buttoned-up" },
  },
  {
    src: "https://example.com/down.jpg",
    attributes: { colorway: "black", size: "m", template: "buttoned-down" },
  },
] as const;

const productVmResulting: DefaultRootViewModel = {
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

function renderStyledView(
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
            product={styledProduct}
            selection={selection}
            vm={productVmResulting}
            carouselSlides={slides}
            initialSlideIndex={0}
            onBack={vi.fn<() => void>()}
            onClose={vi.fn<() => void>()}
            onAddToCart={vi.fn<(attributes: Record<string, string>) => void>()}
            {...props}
          />
        </ErrorProvider>
      </DefaultFlowSheetMount>
    </StudioVaaiUiProvider>,
  );
}

/** A `matchMedia` that answers the responsive layout query the way a phone does. */
function phoneMatchMedia(query: string): MediaQueryList {
  return {
    matches: query === "(max-width: 768px)",
    media: query,
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
  } as unknown as MediaQueryList;
}

/**
 * Runs `body` with the layout resolving to the bottom SHEET. jsdom has no `matchMedia`, so
 * every other render here lands on the modal.
 */
function onAPhone(body: () => void): void {
  Object.defineProperty(globalThis, "matchMedia", {
    value: phoneMatchMedia,
    configurable: true,
  });
  try {
    body();
  } finally {
    // oxlint-disable-next-line typescript-eslint/no-dynamic-delete -- restoring jsdom's own (absent) matchMedia
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
  }
}

function heroSrc(): string | undefined {
  return document.querySelector<HTMLImageElement>("img[src^='https://example.com/']")?.src;
}

/**
 * The row under the photo must read `[pills …] [toggle]`: both inside ONE container, the
 * toggle after the pills in document order (it is right-aligned by the row's flex layout).
 */
function expectPillsThenToggle(): { pills: HTMLElement; toggle: HTMLElement } {
  const pills = screen.getByLabelText("Your try-ons");
  const toggle = screen.getByRole("group", { name: "Switch style" });
  const row = pills.parentElement;
  expect(toggle.parentElement).toBe(row);
  expect(row?.dataset.studioVaai).toBe("try-on-tried-variants");
  // The toggle comes AFTER the pills in the row.
  const children = Array.from(row?.children ?? []);
  expect(children.indexOf(toggle)).toBeGreaterThan(children.indexOf(pills));
  return { pills, toggle };
}

describe("TryOnViewScreen styles", () => {
  afterEach(cleanup);

  it("resolves two slides that differ only by style to different renders", () => {
    const onShownAttributesChange = vi.fn<(attributes: Record<string, string>) => void>();
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderStyledView({ onShownAttributesChange, onSelectVariant });

    const toggle = screen.getByRole("group", { name: "Switch style" });
    const up = within(toggle).getByRole("button", { name: "Buttoned" });
    const down = within(toggle).getByRole("button", { name: "Unbuttoned" });
    expect(up.getAttribute("aria-pressed")).toBe("true");
    expect(down.getAttribute("aria-pressed")).toBe("false");
    expect(heroSrc()).toBe("https://example.com/up.jpg");

    // The companion already exists: the flip is instant and asks the host for nothing.
    act(() => {
      fireEvent.click(down);
    });
    expect(heroSrc()).toBe("https://example.com/down.jpg");
    expect(down.getAttribute("aria-pressed")).toBe("true");
    expect(onShownAttributesChange).toHaveBeenLastCalledWith({
      colorway: "black",
      size: "m",
      template: "buttoned-down",
    });
    expect(onSelectVariant).not.toHaveBeenCalled();

    // And back: the same size and colour must not collapse onto the other style's slide.
    act(() => {
      fireEvent.click(up);
    });
    expect(heroSrc()).toBe("https://example.com/up.jpg");
  });

  it("asks the host to render a style that has no slide yet", () => {
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    renderStyledView({ carouselSlides: [slides[0]], onSelectVariant });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Unbuttoned" }));
    });
    expect(onSelectVariant).toHaveBeenCalledWith({
      colorway: "black",
      size: "m",
      template: "buttoned-down",
    });
  });

  it("keeps the desktop style toggle without tried-size bubbles, and both on mobile", () => {
    renderStyledView();
    expect(screen.queryByLabelText("Your try-ons")).toBeNull();
    expect(screen.getByRole("group", { name: "Switch style" }).className).toContain("sv:ml-auto");
    cleanup();
    onAPhone(() => {
      renderStyledView();
      expect(expectPillsThenToggle().toggle.className).toContain("sv:ml-auto");
    });
  });

  it("draws one pill per size and colour; the toggle, not a second pill, names the style", () => {
    onAPhone(() => renderStyledView());
    const { pills, toggle } = expectPillsThenToggle();
    // Both styles of M / Schwarz are rendered, yet the shopper tried ONE garment: one pill.
    const pill = within(pills).getByRole("button", { name: "M, Schwarz" });
    expect(within(pills).getAllByRole("button")).toHaveLength(1);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    // Only the colour swatch and the size label: the toggle beside the row is what names the
    // style on screen, so the pill carries neither a glyph nor the host's icon.
    expect(pill.querySelector("svg")).toBeNull();
    expect(pill.querySelector("img")).toBeNull();
    expect(pill.textContent).toBe("M");
    // Flipping the style swaps the hero within that same pill; it stays the one selected pill.
    act(() => {
      fireEvent.click(within(toggle).getByRole("button", { name: "Unbuttoned" }));
    });
    expect(heroSrc()).toBe("https://example.com/down.jpg");
    expect(within(pills).getAllByRole("button")).toHaveLength(1);
    expect(
      within(pills).getByRole("button", { name: "M, Schwarz" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("opens a pill in the style currently on screen when that companion exists", () => {
    const sSlides = [
      {
        src: "https://example.com/s-up.jpg",
        attributes: { colorway: "black", size: "s", template: "buttoned-up" },
      },
      {
        src: "https://example.com/s-down.jpg",
        attributes: { colorway: "black", size: "s", template: "buttoned-down" },
      },
    ] as const;
    onAPhone(() =>
      renderStyledView({ carouselSlides: [...slides, ...sSlides], initialSlideIndex: 1 }),
    );
    const { pills, toggle } = expectPillsThenToggle();
    // Two sizes tried, both styles each: two pills, not four.
    expect(within(pills).getAllByRole("button")).toHaveLength(2);
    expect(
      within(toggle).getByRole("button", { name: "Unbuttoned" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // The S pill lands on S in the style that is on screen (unbuttoned), not on its first render.
    act(() => {
      fireEvent.click(within(pills).getByRole("button", { name: "S, Schwarz" }));
    });
    expect(heroSrc()).toBe("https://example.com/s-down.jpg");
    expect(
      within(pills).getByRole("button", { name: "S, Schwarz" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(pills).getByRole("button", { name: "M, Schwarz" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it.each([
    ["letter sizes", ["xs", "s", "m", "l", "xl"]],
    ["numeric sizes", ["2", "4", "10", "12"]],
    ["custom size slugs", ["petite", "regular", "relaxed"]],
  ])("orders phone bubbles by the product's size run for %s", (_name, sizes) => {
    const product: TryOnFlowProduct = {
      ...testProduct,
      variants: sizes.map((size) => ({ id: `v-${size}`, attributes: { size, colorway: "black" } })),
      attributeMetadata: {
        ...testProduct.attributeMetadata,
        sizes: sizes.map((size) => ({ slug: size, label: size })),
      },
    };
    const historySlides = sizes.toReversed().map((size) => ({
      src: `https://example.com/${size}.jpg`,
      attributes: { size, colorway: "black" },
    }));
    const onSelectVariant = vi.fn<(attributes: Record<string, string>) => void>();
    onAPhone(() => renderStyledView({ product, carouselSlides: historySlides, onSelectVariant }));
    const pills = screen.getByLabelText("Your try-ons");
    const buttons = within(pills).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(sizes);
    expect(buttons.at(-1)?.getAttribute("aria-pressed")).toBe("true");

    for (const size of sizes) {
      act(() => {
        fireEvent.click(within(pills).getByRole("button", { name: `${size}, Schwarz` }));
      });
      expect(heroSrc()).toBe(`https://example.com/${size}.jpg`);
      expect(
        within(pills)
          .getByRole("button", { name: `${size}, Schwarz` })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    }
    expect(onSelectVariant).not.toHaveBeenCalled();
  });

  it("keeps equal-size colours in tried order and unknown sizes after the size run", () => {
    const historySlides = [
      { src: "https://example.com/unknown.jpg", attributes: { size: "old", colorway: "black" } },
      { src: "https://example.com/m-black.jpg", attributes: { size: "m", colorway: "black" } },
      { src: "https://example.com/s.jpg", attributes: { size: "s", colorway: "black" } },
      { src: "https://example.com/m-navy.jpg", attributes: { size: "m", colorway: "navy" } },
      { src: "https://example.com/other.jpg", attributes: { size: "other", colorway: "black" } },
      { src: "https://example.com/m-new.jpg", attributes: { size: "m", colorway: "black" } },
    ];
    onAPhone(() => renderStyledView({ product: testProduct, carouselSlides: historySlides }));
    const pills = screen.getByLabelText("Your try-ons");
    const buttons = within(pills).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(buttons.slice(0, 3).map((button) => button.getAttribute("aria-label"))).toEqual([
      "S, Schwarz",
      "M, Schwarz",
      "M, Marine",
    ]);
    act(() => {
      fireEvent.click(within(pills).getByRole("button", { name: "M, Schwarz" }));
    });
    expect(heroSrc()).toBe("https://example.com/m-new.jpg");
    // The two historical sizes follow the known sizes and still open their own renders.
    act(() => {
      fireEvent.click(buttons[3]);
    });
    expect(heroSrc()).toBe("https://example.com/unknown.jpg");
    act(() => {
      fireEvent.click(buttons[4]);
    });
    expect(heroSrc()).toBe("https://example.com/other.jpg");
  });

  it("shows the row from the first render on a styled garment", () => {
    onAPhone(() => renderStyledView({ carouselSlides: [slides[0]] }));
    const { pills, toggle } = expectPillsThenToggle();
    expect(within(pills).getAllByRole("button")).toHaveLength(1);
    expect(
      within(toggle).getByRole("button", { name: "Buttoned" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("does not draw the toggle while a render is in flight", () => {
    onAPhone(() =>
      renderStyledView({ vm: { ...productVmResulting, tryOnPipeline: "requesting" } }),
    );
    expect(screen.queryByRole("group", { name: "Switch style" })).toBeNull();
    // The finished renders' pill stays (both styles of M / Schwarz are one pick).
    expect(within(screen.getByLabelText("Your try-ons")).getAllByRole("button")).toHaveLength(1);

    cleanup();
    // With nothing rendered yet there is no row at all, not a toggle alone.
    renderStyledView({
      vm: { ...productVmResulting, tryOnPipeline: "requesting" },
      carouselSlides: [slides[0]],
    });
    expect(screen.queryByRole("group", { name: "Switch style" })).toBeNull();
    expect(screen.queryByLabelText("Your try-ons")).toBeNull();
  });

  it("hides the toggle on a single-style product, and the row below two renders", () => {
    renderStyledView({
      product: testProduct,
      selection: { colorway: "black", size: "m" },
      carouselSlides: [
        { src: "https://example.com/a.jpg", attributes: { colorway: "black", size: "m" } },
      ],
    });
    expect(screen.queryByRole("group", { name: "Switch style" })).toBeNull();
    expect(screen.queryByLabelText("Your try-ons")).toBeNull();
  });
});
