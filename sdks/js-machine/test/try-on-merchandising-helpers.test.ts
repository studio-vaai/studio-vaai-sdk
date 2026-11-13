import type { ProductId } from "@studio-vaai/js-client";

import { describe, expect, it } from "vitest";

import type { TryOnFlowProduct } from "../src/context/index.js";

import { tryOnColorwayOptionForAttribute } from "../src/try-on-merchandising-helpers.js";

function makeProduct(overrides: Partial<TryOnFlowProduct>): TryOnFlowProduct {
  return {
    id: "test" as ProductId,
    displayName: "x",
    variants: [],
    attributeMetadata: { colorways: [], sizes: [{ slug: "m", label: "M" }] },
    ...overrides,
  };
}

describe("tryOnColorwayOptionForAttribute", () => {
  it("returns undefined when colors is empty", () => {
    const product = makeProduct({ attributeMetadata: { colorways: [], sizes: [] } });
    expect(tryOnColorwayOptionForAttribute(product, "default")).toBeUndefined();
    expect(tryOnColorwayOptionForAttribute(product)).toBeUndefined();
  });

  it("returns first color when attribute missing and colors non-empty", () => {
    const a = { slug: "a", label: "A", hex: "#111" };
    const b = { slug: "b", label: "B", hex: "#222" };
    const product = makeProduct({ attributeMetadata: { colorways: [a, b], sizes: [] } });
    expect(tryOnColorwayOptionForAttribute(product, "")).toBe(a);
    expect(tryOnColorwayOptionForAttribute(product)).toBe(a);
  });

  it("resolves matching slug", () => {
    const a = { slug: "a", label: "A", hex: "#111" };
    const b = { slug: "b", label: "B", hex: "#222" };
    const product = makeProduct({ attributeMetadata: { colorways: [a, b], sizes: [] } });
    expect(tryOnColorwayOptionForAttribute(product, "b")).toBe(b);
  });
});
