import type { ProductId } from "@studio-vaai/js-client";

import { sizeKeyOf } from "@studio-vaai/js-client";
import { describe, expect, it } from "vitest";

import type { ProductAxis } from "../src/try-on-flow-product.js";

import { companionStyleSelections, findVariantByAttributes } from "../src/context/index.js";
import { buildTryOnFlowProduct } from "../src/try-on-flow-product.js";
import {
  variantCombinationFor,
  variantForeignIds,
  variantValueAvailable,
} from "../src/variant-axes.js";

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test fixture id
const productId = "product-1" as ProductId;

const colorways: ProductAxis = {
  key: "colorway",
  label: "Colour",
  items: [
    { key: "A100-259", display: { text: "Espresso", hex: "#3b2a20" } },
    { key: "A100-310", display: { text: "Stripe", image: "https://cdn.test/stripe.jpg" } },
    { key: "A100-400", display: { text: "Ivory", hex: "#fff8e7", swatchRing: true } },
  ],
};

function variantsOf(
  ...ids: readonly Readonly<Record<string, string>>[]
): { id: string; foreignVariantIds: Readonly<Record<string, string>> }[] {
  return ids.map((foreignIds, index) => ({
    id: `variant-${String(index)}`,
    foreignVariantIds: foreignIds,
  }));
}

describe("buildTryOnFlowProduct on a size-only product", () => {
  const product = buildTryOnFlowProduct({
    productId,
    displayName: "Linen Blazer",
    productThumbnailUrl: "https://cdn.test/blazer.jpg",
    priceLabel: "€159",
    axes: [
      colorways,
      {
        key: "size",
        label: "Size",
        items: [
          { key: "L", display: { text: "Large" } },
          { key: "S", display: { text: "Small" } },
          { key: "M", display: { text: "Medium" }, soldOut: true },
        ],
      },
    ],
    variants: variantsOf(
      { colorway: "A100-259", size: "S" },
      { colorway: "A100-259", size: "M" },
      { colorway: "A100-310", size: "L" },
    ),
  });

  it("carries the host's chrome through", () => {
    expect(product).toMatchObject({
      id: productId,
      displayName: "Linen Blazer",
      productThumbnailUrl: "https://cdn.test/blazer.jpg",
      priceLabel: "€159",
    });
  });

  it("derives colorways from the colorway axis, with a hex fallback for an image-only swatch", () => {
    expect(product.attributeMetadata.colorways).toEqual([
      { slug: "A100-259", label: "Espresso", hex: "#3b2a20" },
      {
        slug: "A100-310",
        label: "Stripe",
        hex: expect.stringMatching(/^#[0-9a-f]{6}$/),
        imageUrl: "https://cdn.test/stripe.jpg",
      },
      { slug: "A100-400", label: "Ivory", hex: "#fff8e7", swatchRing: true },
    ]);
  });

  it("lists one size per item in the host's order, sold-out and unsold ones included", () => {
    expect(product.attributeMetadata.sizes).toEqual([
      { slug: "L", label: "Large" },
      { slug: "S", label: "Small" },
      { slug: "M", label: "Medium", soldOut: true },
    ]);
    expect(product.attributeMetadata).not.toHaveProperty("variantAxes");
    expect(product.attributeMetadata).not.toHaveProperty("styles");
  });

  it("selects variants by the shop's ids and gives back the API's id", () => {
    expect(product.variants[0]).toEqual({
      id: "variant-0",
      attributes: { colorway: "A100-259", size: "S" },
    });
    expect(findVariantByAttributes(product, { colorway: "A100-310", size: "L" })?.id).toBe(
      "variant-2",
    );
    expect(findVariantByAttributes(product, { colorway: "A100-310", size: "S" })).toBeUndefined();
  });

  it("hands the shop back the same ids it supplied", () => {
    const selection = { colorway: "A100-259", size: "S" };
    expect(variantForeignIds(product, selection)).toEqual(selection);
  });
});

describe("buildTryOnFlowProduct on a waist × length product", () => {
  const waist: ProductAxis = {
    key: "size",
    label: "Waist",
    items: [
      { key: "27", display: { text: "W27" } },
      { key: "28", display: { text: "W28" }, soldOut: true },
      { key: "30", display: { text: "W30" } },
    ],
  };
  const length: ProductAxis = {
    key: "style",
    label: "Length",
    items: [
      { key: "30", display: { text: "L30" } },
      { key: "32", display: { text: "L32" } },
    ],
  };
  const variants = variantsOf(
    { colorway: "A100-259", size: "30", style: "32" },
    { colorway: "A100-259", size: "27", style: "30" },
    { colorway: "A100-259", size: "28", style: "32" },
    { colorway: "A100-310", size: "27", style: "30" },
  );
  const product = buildTryOnFlowProduct({
    productId,
    displayName: "Loose Fit Jeans",
    axes: [colorways, waist, length],
    variants,
  });

  it("lists only sold combinations, in the host's axis order rather than the variants'", () => {
    expect(product.attributeMetadata.sizes).toEqual([
      { slug: "27 / 30", label: "W27 / L30", options: { size: "27", style: "30" } },
      { slug: "28 / 32", label: "W28 / L32", options: { size: "28", style: "32" }, soldOut: true },
      { slug: "30 / 32", label: "W30 / L32", options: { size: "30", style: "32" } },
    ]);
  });

  it("offers the size axes as pickers with the shop's labels", () => {
    expect(product.attributeMetadata.variantAxes).toEqual([
      {
        key: "size",
        label: "Waist",
        values: [
          { slug: "27", label: "W27" },
          { slug: "28", label: "W28" },
          { slug: "30", label: "W30" },
        ],
      },
      {
        key: "style",
        label: "Length",
        values: [
          { slug: "30", label: "L30" },
          { slug: "32", label: "L32" },
        ],
      },
    ]);
  });

  it("selects by size key, so every helper keeps working on the shop's ids", () => {
    expect(product.variants[1]?.attributes).toEqual({ colorway: "A100-259", size: "27 / 30" });
    expect(findVariantByAttributes(product, { colorway: "A100-310", size: "27 / 30" })?.id).toBe(
      "variant-3",
    );
    expect(variantValueAvailable(product, "27 / 30", "size", "30")).toBe(false);
    expect(variantCombinationFor(product, "27 / 30", "size", "30")).toBe("30 / 32");
  });

  it("agrees with the size key recommendations are mapped to", () => {
    const fromRecommendation = sizeKeyOf({ size: "27", style: "30" });
    expect(product.attributeMetadata.sizes.map((size) => size.slug)).toContain(fromRecommendation);
  });

  it("expands the size key to one id per axis for the shop's cart", () => {
    expect(variantForeignIds(product, { colorway: "A100-259", size: "30 / 32" })).toEqual(
      variants[0]?.foreignVariantIds,
    );
  });

  it("uses the axis order the host gives, also when length comes first", () => {
    const lengthFirst = buildTryOnFlowProduct({
      productId,
      displayName: "Loose Fit Jeans",
      axes: [length, waist],
      variants,
    });
    expect(lengthFirst.attributeMetadata.variantAxes?.map((axis) => axis.key)).toEqual([
      "style",
      "size",
    ]);
    expect(lengthFirst.attributeMetadata.sizes[0]).toEqual({
      slug: "27 / 30",
      label: "L30 / W27",
      options: { style: "30", size: "27" },
    });
  });
});

describe("buildTryOnFlowProduct on a multi-template product", () => {
  const product = buildTryOnFlowProduct({
    productId,
    displayName: "Double-breasted Blazer",
    axes: [
      colorways,
      {
        key: "template",
        label: "Style",
        items: [
          { key: "T-UP", display: { text: "Buttoned up", glyph: "buttoned-up" } },
          { key: "T-DOWN", display: { text: "Open", image: "https://cdn.test/open.svg" } },
        ],
      },
      { key: "size", label: null, items: [{ key: "M", display: { text: "M" } }] },
    ],
    variants: variantsOf(
      { colorway: "A100-259", size: "M", template: "T-UP" },
      { colorway: "A100-259", size: "M", template: "T-DOWN" },
    ),
  });

  it("derives styles from the template axis, which never counts as a size axis", () => {
    expect(product.attributeMetadata.styles).toEqual([
      { slug: "T-UP", label: "Buttoned up", glyph: "buttoned-up" },
      { slug: "T-DOWN", label: "Open", iconUrl: "https://cdn.test/open.svg" },
    ]);
    expect(product.attributeMetadata).not.toHaveProperty("variantAxes");
    expect(product.attributeMetadata.sizes).toEqual([{ slug: "M", label: "M" }]);
  });

  it("keeps the template out of the size key and in the attributes", () => {
    expect(product.variants[1]).toEqual({
      id: "variant-1",
      attributes: { colorway: "A100-259", template: "T-DOWN", size: "M" },
    });
  });

  it("finds the other style's variant for a companion render", () => {
    const [companion] = companionStyleSelections(product, {
      colorway: "A100-259",
      template: "T-UP",
      size: "M",
    });
    expect(companion).toEqual({ colorway: "A100-259", template: "T-DOWN", size: "M" });
    expect(findVariantByAttributes(product, companion ?? {})?.id).toBe("variant-1");
  });
});

describe("buildTryOnFlowProduct and the shop's variant ids", () => {
  it("keeps a variant's own shop id and leaves it out where the shop names none", () => {
    const product = buildTryOnFlowProduct({
      productId,
      displayName: "Linen Blazer",
      axes: [
        colorways,
        { key: "size", label: "Size", items: [{ key: "S", display: { text: "S" } }] },
      ],
      variants: [
        {
          id: "variant-0",
          foreignVariantIds: { colorway: "A100-259", size: "S" },
          foreignId: "44718293",
        },
        { id: "variant-1", foreignVariantIds: { colorway: "A100-310", size: "S" } },
      ],
    });
    expect(product.variants[0]?.foreignId).toBe("44718293");
    expect(product.variants[1]).not.toHaveProperty("foreignId");
  });
});
