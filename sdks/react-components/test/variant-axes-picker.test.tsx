// @vitest-environment jsdom

import type { ProductId } from "@studio-vaai/js-client";
import type { TryOnFlowProduct } from "@studio-vaai/js-machine";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VariantPickerAxis } from "../src/ui/variant-picker.js";

import { splitSizeAxis } from "../src/batteries/variant-axes-picker.js";
import { StudioVaaiUiProvider } from "../src/studio-vaai-ui-provider.js";
import { VariantPicker } from "../src/ui/variant-picker.js";

const copy = {
  variantAxisLabel: (axis: string, value: string) => `${axis}: ${value}`,
  recommendedChip: (label: string) => `Recommended ${label}`,
  variantUnavailableSr: "not available in this combination",
};

const COMBOS: [string, string][] = [
  ["27", "l30"],
  ["27", "l34"],
  ["28", "l32"],
  ["28", "l34"],
  ["30", "l30"],
  ["30", "l32"],
];

function jeans(): TryOnFlowProduct {
  const sizes = COMBOS.map(([waist, length]) => ({
    slug: `${waist}-${length}`,
    label: `${waist} / ${length.slice(1)}`,
    options: { size: waist, style: length },
  }));
  return {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test fixture id
    id: "jeans" as ProductId,
    displayName: "Loose Fit Jeans",
    variants: sizes.map((size) => ({ id: `v-${size.slug}`, attributes: { size: size.slug } })),
    attributeMetadata: {
      colorways: [],
      sizes,
      variantAxes: [
        {
          key: "size",
          label: "Waist",
          values: ["27", "28", "30"].map((w) => ({ slug: w, label: w })),
        },
        {
          key: "style",
          label: "Length",
          values: ["l30", "l32", "l34"].map((l) => ({ slug: l, label: l.slice(1) })),
        },
      ],
    },
  };
}

function sizeAxis(
  product: TryOnFlowProduct,
  selected: string,
  onSelect: (value: string) => void,
): VariantPickerAxis {
  return {
    key: "size",
    label: "Size",
    options: product.attributeMetadata.sizes.map((size) => ({
      value: size.slug,
      label: size.label,
      ...(size.slug === "27-l30" ? { gated: true } : {}),
    })),
    selected,
    recommended: "30-l32",
    recommendationLabel: "Recommended 30 / 32",
    onSelect,
  };
}

const MADDIE_OPTIONS = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "3xl", "4xl"].map((slug) => ({
  value: slug,
  label: slug.toUpperCase(),
}));
const MADDIE_AXES: readonly VariantPickerAxis[] = [
  {
    key: "size",
    label: "Size: M",
    options: MADDIE_OPTIONS,
    selected: "m",
    onSelect: vi.fn<(value: string) => void>(),
  },
];

describe("splitSizeAxis", () => {
  afterEach(cleanup);

  it("returns a single-axis product's size row untouched", () => {
    const product: TryOnFlowProduct = {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test fixture id
      id: "maddie" as ProductId,
      displayName: "Wide Leg Jeans",
      variants: [{ id: "v-m", attributes: { size: "m" } }],
      attributeMetadata: {
        colorways: [],
        sizes: ["xxs", "xs", "s", "m", "l", "xl", "xxl", "3xl", "4xl"].map((slug) => ({
          slug,
          label: slug.toUpperCase(),
        })),
      },
    };
    const axis: VariantPickerAxis = {
      key: "size",
      label: "Size: M",
      options: product.attributeMetadata.sizes.map((s) => ({ value: s.slug, label: s.label })),
      selected: "m",
      onSelect: vi.fn<(value: string) => void>(),
    };
    const axes = splitSizeAxis(product, axis, copy, "a length hint");
    expect(axes).toHaveLength(1);
    expect(axes[0]).toBe(axis);
  });

  it("renders a single-axis picker exactly as before", () => {
    const { container } = render(
      <StudioVaaiUiProvider locale="en">
        <VariantPicker axes={MADDIE_AXES} />
      </StudioVaaiUiProvider>,
    );
    expect(container.querySelectorAll("[data-sv-axis]")).toHaveLength(1);
    expect(container.querySelector("[data-sv-unavailable]")).toBeNull();
    expect(container.querySelector('[data-studio-vaai="try-on-axis-hint"]')).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "XXS",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
      "4XL",
    ]);
  });

  it("splits a waist × length product into one row per axis", () => {
    const product = jeans();
    const onSelect = vi.fn<(value: string) => void>();
    const [waist, length] = splitSizeAxis(
      product,
      sizeAxis(product, "27-l30", onSelect),
      copy,
      "hem at the ankle",
    );
    expect(waist?.label).toBe("Waist: 27");
    expect(waist?.selected).toBe("27");
    expect(waist?.recommended).toBe("30");
    expect(waist?.recommendationLabel).toBe("Recommended 30");
    // 28 has no length 30; the gate verdict of 27/30 rides along.
    expect(waist?.options.map((o) => [o.value, o.unavailable === true, o.gated === true])).toEqual([
      ["27", false, true],
      ["28", true, false],
      ["30", false, false],
    ]);
    expect(length?.label).toBe("Length: 30");
    expect(length?.recommended).toBe("l32");
    expect(length?.hint).toBe("hem at the ankle");
    expect(length?.options.map((o) => o.unavailable === true)).toEqual([false, true, false]);

    // A greyed length moves the waist to the nearest combination that has it.
    length?.onSelect("l32");
    expect(onSelect).toHaveBeenLastCalledWith("28-l32");
    waist?.onSelect("30");
    expect(onSelect).toHaveBeenLastCalledWith("30-l30");
  });

  it("draws unavailable values greyed but still tappable", () => {
    const product = jeans();
    const onSelect = vi.fn<(value: string) => void>();
    render(
      <StudioVaaiUiProvider locale="en">
        <VariantPicker axes={splitSizeAxis(product, sizeAxis(product, "27-l30", onSelect), copy)} />
      </StudioVaaiUiProvider>,
    );
    const greyed = screen.getByRole("button", { name: "28 (not available in this combination)" });
    expect(greyed.dataset.svUnavailable).toBe("true");
    fireEvent.click(greyed);
    expect(onSelect).toHaveBeenCalledWith("28-l32");
  });
});
