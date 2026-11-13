import type { ProductId } from "@studio-vaai/js-client";

import { describe, expect, it } from "vitest";

import type { TryOnFlowProduct } from "../src/context/index.js";

import {
  productVariantAxes,
  variantCombinationFor,
  variantForeignIds,
  variantValueAvailable,
} from "../src/variant-axes.js";

const WAISTS = ["27", "28", "30"];
const LENGTHS = ["l30", "l32", "l34"];
/** A jeans product where 27/32 and 28/30 are not sold. */
const MISSING = new Set(["27-l32", "28-l30"]);

function jeans(): TryOnFlowProduct {
  const sizes = WAISTS.flatMap((waist) =>
    LENGTHS.filter((length) => !MISSING.has(`${waist}-${length}`)).map((length) => ({
      slug: `${waist}-${length}`,
      label: `${waist} / ${length.slice(1)}`,
      options: { size: waist, style: length },
    })),
  );
  return {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test fixture id
    id: "jeans" as ProductId,
    displayName: "Loose Fit Jeans",
    variants: sizes.map((size) => ({
      id: `v-${size.slug}`,
      attributes: { colorway: "blue", size: size.slug },
    })),
    attributeMetadata: {
      colorways: [{ slug: "blue", label: "Blue", hex: "#00f" }],
      sizes,
      variantAxes: [
        { key: "size", label: "Waist", values: WAISTS.map((w) => ({ slug: w, label: w })) },
        {
          key: "style",
          label: "Length",
          values: LENGTHS.map((l) => ({ slug: l, label: l.slice(1) })),
        },
      ],
    },
  };
}

function singleAxis(): TryOnFlowProduct {
  return {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test fixture id
    id: "tee" as ProductId,
    displayName: "Tee",
    variants: [{ id: "v-m", attributes: { size: "m" } }],
    attributeMetadata: { colorways: [], sizes: [{ slug: "m", label: "M" }] },
  };
}

describe("variant axes", () => {
  it("leaves a size-only product alone", () => {
    const product = singleAxis();
    const selection = { size: "m" };
    expect(productVariantAxes(product)).toBeUndefined();
    expect(variantForeignIds(product, selection)).toBe(selection);
  });

  it("names the chosen combination one id per axis for the shop's cart", () => {
    expect(variantForeignIds(jeans(), { colorway: "blue", size: "27-l30" })).toEqual({
      colorway: "blue",
      size: "27",
      style: "l30",
    });
  });

  it("greys a value that is not sold with the other axis' pick", () => {
    const product = jeans();
    expect(variantValueAvailable(product, "27-l30", "style", "l32")).toBe(false);
    expect(variantValueAvailable(product, "27-l30", "style", "l34")).toBe(true);
    expect(variantValueAvailable(product, "27-l30", "size", "28")).toBe(false);
    expect(variantValueAvailable(product, "27-l30", "size", "30")).toBe(true);
    // Nothing picked yet: any combination carrying the value counts.
    expect(variantValueAvailable(product, undefined, "size", "28")).toBe(true);
  });

  it("keeps the other axis when it can and moves it the least when it cannot", () => {
    const product = jeans();
    expect(variantCombinationFor(product, "27-l30", "size", "30")).toBe("30-l30");
    // 28/30 is not sold: the nearest length for waist 28 is 32.
    expect(variantCombinationFor(product, "27-l30", "size", "28")).toBe("28-l32");
    expect(variantCombinationFor(product, "27-l30", "style", "l32")).toBe("28-l32");
    expect(variantCombinationFor(product, undefined, "style", "l34")).toBe("27-l34");
  });
});
