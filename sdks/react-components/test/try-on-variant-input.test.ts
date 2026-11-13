import type { ProductId } from "@studio-vaai/js-client";

import { buildTryOnFlowProduct } from "@studio-vaai/js-machine";
import { describe, expect, it } from "vitest";

import { tryOnVariantInput } from "../src/try-on-variant-input.js";

const product = buildTryOnFlowProduct({
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test fixture id
  productId: "product-1" as ProductId,
  displayName: "Straight Jeans",
  axes: [
    {
      key: "colorway",
      label: "Colour",
      items: [{ key: "A100-259", display: { text: "Espresso" } }],
    },
    { key: "size", label: "Waist", items: [{ key: "27", display: { text: "27" } }] },
    { key: "style", label: "Length", items: [{ key: "30", display: { text: "30" } }] },
  ],
  variants: [
    {
      id: "variant-1",
      foreignVariantIds: { colorway: "A100-259", size: "27", style: "30" },
      foreignId: "44718293",
    },
  ],
});

describe("tryOnVariantInput", () => {
  it("gives the shop the matched variant's ids: ours, the shop's own and per axis", () => {
    const attributes = { colorway: "A100-259", size: "27 / 30" };
    expect(tryOnVariantInput(product, attributes)).toEqual({
      product,
      attributes,
      variantId: "variant-1",
      foreignId: "44718293",
      foreignVariantIds: { colorway: "A100-259", size: "27", style: "30" },
    });
  });

  it("leaves the id out when the product no longer sells the attributes", () => {
    const input = tryOnVariantInput(product, { colorway: "A100-999", size: "27 / 30" });
    expect(input).not.toHaveProperty("variantId");
    expect(input).not.toHaveProperty("foreignId");
    expect(input.foreignVariantIds).toEqual({ colorway: "A100-999", size: "27", style: "30" });
  });
});
