import { describe, expect, it } from "vitest";

import type { ProductId } from "../src/index.js";

import { API_VERSION, createFetchStudioVaaiClient, sizeKeyOf } from "../src/index.js";

const PRODUCT = "019febf2-33be-7174-8949-6f0082b20f40" as ProductId;

function fakeFetch(status: number, body: unknown, seen: Request[]): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    seen.push(request);
    return Response.json(body, {
      status,
      headers: {
        "Content-Type": status === 200 ? "application/json" : "application/problem+json",
      },
    });
  };
}

describe("sizeKeyOf", () => {
  it("names a single-axis size by its value", () => {
    expect(sizeKeyOf({ size: "M" })).toBe("M");
  });

  it("puts size first, then the other axes alphabetically", () => {
    expect(sizeKeyOf({ size: "27", style: "30" })).toBe("27 / 30");
    expect(sizeKeyOf({ style: "30", fit: "tall", size: "27" })).toBe("27 / tall / 30");
  });

  it("leaves out the axes that are not part of a size", () => {
    expect(sizeKeyOf({ colorway: "A100-259", template: "T1", size: "M" })).toBe("M");
  });
});

describe("catalog.getProductDetails", () => {
  it("sends the shop key and returns the variants", async () => {
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test/",
      clientApiKey: "sv_client_test",
      fetch: fakeFetch(
        200,
        {
          productId: PRODUCT,
          variants: [
            { id: "v1", foreignVariantIds: { colorway: "A100-259", size: "XS" } },
            { id: "v2", foreignVariantIds: { colorway: "A100-259", size: "M" } },
          ],
        },
        seen,
      ),
    });
    const result = await client.catalog?.getProductDetails({ productId: PRODUCT });
    expect(result).toEqual({
      ok: true,
      data: {
        productId: PRODUCT,
        variants: [
          { id: "v1", foreignVariantIds: { colorway: "A100-259", size: "XS" } },
          { id: "v2", foreignVariantIds: { colorway: "A100-259", size: "M" } },
        ],
      },
    });
    const request = seen[0];
    expect(request?.url).toBe(`https://api.example.test/products/${PRODUCT}`);
    expect(request?.headers.get("X-Client-Api-Key")).toBe("sv_client_test");
    expect(request?.headers.get("X-Api-Version")).toBe(API_VERSION);
  });

  it("asks for and passes the provenance through when the client opts in", async () => {
    const provenance = {
      productId: PRODUCT,
      garmentSlug: "sample-loose-jeans",
      revisionNumber: 5,
      manifestHash: "19cc3f79".padEnd(64, "0"),
      promotedAt: "2026-10-07T09:30:00Z",
      sizes: [
        {
          sizeSlug: "27-l30",
          templateSlug: "loose-fit-jeans",
          pieceId: "01933e8e-0000-7000-8000-00000000a001",
          bakeHash: "7a1c".padEnd(64, "0"),
        },
      ],
    };
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      includeProvenance: true,
      fetch: fakeFetch(200, { productId: PRODUCT, variants: [], provenance }, seen),
    });
    const result = await client.catalog?.getProductDetails({ productId: PRODUCT });
    expect(result?.ok).toBe(true);
    if (result?.ok !== true) {
      return;
    }
    expect(result.data.provenance).toEqual(provenance);
    expect(seen[0]?.url).toBe(`https://api.example.test/products/${PRODUCT}?include=provenance`);
  });

  it("asks for no provenance unless the client opts in", async () => {
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      fetch: fakeFetch(200, { productId: PRODUCT, variants: [] }, seen),
    });
    await client.catalog?.getProductDetails({ productId: PRODUCT });
    expect(seen[0]?.url).toBe(`https://api.example.test/products/${PRODUCT}`);
  });

  it("maps an unknown product to a failure", async () => {
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      fetch: fakeFetch(404, { kind: "product-not-found", title: "Product not found" }, []),
    });
    const result = await client.catalog?.getProductDetails({ productId: PRODUCT });
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});

describe("catalog.getProductByForeignId", () => {
  it("escapes the shop's id into the path", async () => {
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      fetch: fakeFetch(200, { productId: PRODUCT, variants: [] }, seen),
    });
    const result = await client.catalog?.getProductByForeignId({ foreignId: "A 100" });
    expect(result?.ok === true ? result.data.productId : null).toBe(PRODUCT);
    expect(seen[0]?.url).toBe("https://api.example.test/products/by-foreign-id/A%20100");
  });
});

describe("catalog.listProducts", () => {
  it("lists the shop's product ids", async () => {
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      fetch: fakeFetch(200, { products: [{ productId: PRODUCT }] }, seen),
    });
    const result = await client.catalog?.listProducts({});
    expect(result).toEqual({ ok: true, data: [PRODUCT] });
    expect(seen[0]?.url).toBe("https://api.example.test/products");
  });
});
