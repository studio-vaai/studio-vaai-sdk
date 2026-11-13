import { describe, expect, it } from "vitest";

import {
  createFetchStudioVaaiClient,
  type BodyId,
  type ProductId,
  type SessionHandle,
  type SessionActivity,
} from "../src/index.js";

const bodyId = "body" as BodyId,
  productId = "product" as ProductId,
  session = "session" as SessionHandle;
const summary = {
  bodyId,
  createdAt: "2026-11-05T12:00:00Z",
  estimatedHeightCm: 175,
  sourceImageUrl: "https://images.test/source.jpg",
  sourceImageUrlExpiresAt: "2026-11-05T12:15:00Z",
};
function fixture(handler: (r: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = createFetchStudioVaaiClient({
    baseUrl: "https://api.test",
    clientApiKey: "shop-key",
    sessionTransport: "bearer",
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requests.push(req);
      return await handler(req);
    },
  });
  return { client, requests };
}
describe("reviewed API wire contract", () => {
  it("does not renew activity for reads or credential refresh, even with a legacy caller flag", async () => {
    const f = fixture((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/session/bearer/refresh") {
        return Response.json({ token: "rotated", expiresAt: summary.sourceImageUrlExpiresAt });
      }
      if (path === "/session") {
        return Response.json({ expiresAt: summary.sourceImageUrlExpiresAt });
      }
      if (path === "/bodies") {
        return Response.json({ bodies: [] });
      }
      if (path.endsWith("/recommended-size")) {
        return Response.json({ recommendations: [] });
      }
      return Response.json({
        status: "completed",
        tryOnId: "try-on",
        imageUrl: "https://images.test/result.jpg",
        scene: { overlayColor: "#fff" },
      });
    });
    const activity: SessionActivity[] = [];
    f.client.onSessionActivity?.((event) => activity.push(event));
    const legacyOptions = { signal: new AbortController().signal, userEngagement: true };
    await f.client.session.getSession({ session }, legacyOptions);
    await f.client.session.refreshSession({ session }, legacyOptions);
    await f.client.body.listBodies({ session }, legacyOptions);
    await f.client.tryOn.getRecommendedSize({ session, bodyId, productId }, legacyOptions);
    await f.client.tryOn.getTryOn({ session, tryOnId: "try-on" }, legacyOptions);
    expect(activity).toEqual([]);
    expect(f.requests).toHaveLength(5);
    expect(f.requests.every((request) => !request.headers.has("X-Vaai-User-Engagement"))).toBe(
      true,
    );
  });

  it("reports a try-on as activity without a caller-controlled flag", async () => {
    const f = fixture(() =>
      Response.json({
        status: "completed",
        tryOnId: "try-on",
        imageUrl: "https://images.test/result.jpg",
        scene: { overlayColor: "#fff" },
      }),
    );
    const activity: SessionActivity[] = [];
    f.client.onSessionActivity?.((event) => activity.push(event));
    const legacyOptions = { signal: new AbortController().signal, userEngagement: false };
    const result = await f.client.tryOn.createTryOn(
      { session, bodyId, productId, attributes: { size: "m" } },
      legacyOptions,
    );
    expect(result.ok).toBe(true);
    expect(activity).toMatchObject([
      { session, phase: "started", accepted: false },
      { session, phase: "settled", accepted: true },
    ]);
    expect(activity[0]?.requestId).toBe(activity[1]?.requestId);
    expect(f.requests[0]?.headers.has("X-Vaai-User-Engagement")).toBe(false);
  });

  it.each([
    { status: 400, kind: "invalid-height", accepted: false },
    { status: 401, kind: "session-expired", accepted: false },
    { status: 404, kind: "body-not-found", accepted: false },
    { status: 422, kind: "height-calibration-failed", accepted: true },
    { status: 422, kind: "invalid-height", accepted: false },
    { status: 500, kind: "internal-server-error", accepted: false },
  ])("reports admission for $kind ($status) as $accepted", async ({ status, kind, accepted }) => {
    const f = fixture(() => Response.json({ kind, title: "Rejected" }, { status }));
    const activity: SessionActivity[] = [];
    f.client.onSessionActivity?.((event) => activity.push(event));
    await f.client.body.setBodyHeight({ session, bodyId, heightCm: 175 });
    expect(activity).toMatchObject([
      { session, phase: "started", accepted: false },
      { session, phase: "settled", accepted },
    ]);
  });

  it("starts photo activity only after upload preparation and the storage upload", async () => {
    const activity: SessionActivity[] = [];
    const f = fixture((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/bodies/upload-urls") {
        expect(activity).toEqual([]);
        return Response.json({
          uploadUrl: "https://staging.test/upload",
          method: "PUT",
          stagingKey: "staging",
          requiredHeaders: [],
          expiresAt: summary.sourceImageUrlExpiresAt,
        });
      }
      if (request.method === "PUT") {
        expect(activity).toEqual([]);
        return new Response(null);
      }
      expect(activity).toMatchObject([{ session, phase: "started", accepted: false }]);
      return Response.json({ status: "ready", body: summary }, { status: 201 });
    });
    f.client.onSessionActivity?.((event) => activity.push(event));
    await f.client.body.createBody({
      session,
      image: { type: "bytes", data: new Uint8Array([1]), mimeType: "image/jpeg" },
    });
    expect(activity).toMatchObject([
      { session, phase: "started", accepted: false },
      { session, phase: "settled", accepted: true },
    ]);
    expect(f.requests.every((request) => !request.headers.has("X-Vaai-User-Engagement"))).toBe(
      true,
    );
  });

  it.each(["http", "transport"])(
    "redacts storage capabilities from %s upload failures",
    async (mode) => {
      const secret = "capability-never-print";
      const f = fixture((req) => {
        if (new URL(req.url).pathname === "/bodies/upload-urls") {
          return Response.json({
            uploadUrl: `https://staging.test/upload?signature=${secret}`,
            method: "PUT",
            stagingKey: "staging",
            requiredHeaders: [],
            expiresAt: summary.sourceImageUrlExpiresAt,
          });
        }
        if (mode === "transport") {
          throw new Error(`Failed at ${req.url}`);
        }
        return new Response(`<Error><StringToSign>${secret}</StringToSign></Error>`, {
          status: 403,
        });
      });
      const result = await f.client.body.createBody({
        session,
        image: { type: "bytes", data: new Uint8Array([1]), mimeType: "image/jpeg" },
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain("StringToSign");
    },
  );

  it("returns the created summary and sends imageMetadata", async () => {
    const f = fixture((req) => {
      const path = new URL(req.url).pathname;
      if (path === "/bodies/upload-urls") {
        return Response.json({
          uploadUrl: "https://staging.test/upload",
          method: "PUT",
          stagingKey: "staging",
          requiredHeaders: [],
          expiresAt: summary.sourceImageUrlExpiresAt,
        });
      }
      if (req.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (path === "/bodies") {
        return Response.json({ status: "ready", body: summary }, { status: 201 });
      }
      throw new Error(`Unexpected ${path}`);
    });
    const result = await f.client.body.createBody({
      session,
      image: { type: "bytes", data: new Uint8Array([1, 2]), mimeType: "image/jpeg" },
      imageMetadata: { originalWidth: 100, originalHeight: 200 },
    });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "ready", created: { body: summary } },
    });
    expect(f.requests).toHaveLength(3);
    await expect(f.requests[2]?.clone().json()).resolves.toMatchObject({
      imageMetadata: { originalWidth: 100, originalHeight: 200 },
    });
  });
  it("maps image validation 422s to shopper-facing validation outcomes", async () => {
    const f = fixture((req) => {
      if (new URL(req.url).pathname === "/bodies/upload-urls") {
        return Response.json({
          uploadUrl: "https://staging.test/upload",
          method: "PUT",
          stagingKey: "staging",
          requiredHeaders: [],
          expiresAt: summary.sourceImageUrlExpiresAt,
        });
      }
      if (req.method === "PUT") {
        return new Response(null);
      }
      return Response.json(
        { kind: "body-validation-failed", title: "Photo rejected", reason: "no_human_detected" },
        { status: 422 },
      );
    });
    const result = await f.client.body.createBody({
      session,
      image: { type: "bytes", data: new Uint8Array([1]), mimeType: "image/jpeg" },
    });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "failed", failure: { code: "no_human_detected" } },
    });
  });
  it("accepts body height's empty 204 response", async () => {
    const f = fixture(() => new Response(null, { status: 204 }));
    await expect(
      f.client.body.setBodyHeight({ session, bodyId, heightCm: 175, productId }),
    ).resolves.toEqual({ ok: true, data: {} });
    expect(f.requests[0]?.method).toBe("PATCH");
    expect(f.requests[0]?.url).toBe("https://api.test/bodies/body/height");
  });
  it.each(["garment_too_small", "garment_too_large"] as const)(
    "handles %s as a typed size rejection",
    async (reason) => {
      const f = fixture(() =>
        Response.json(
          {
            kind: "try-on-size-rejected",
            title: "Size rejected",
            reason,
            tryOnId: "try-on",
            variantId: "variant-m",
            recommendedForeignIds: { size: "L" },
          },
          { status: 422 },
        ),
      );
      await expect(
        f.client.tryOn.createTryOn({ session, bodyId, productId, variantId: "variant-m" }),
      ).resolves.toEqual({
        ok: true,
        data: { status: "error", reason: { kind: reason, recommendedSize: "L" } },
      });
      expect(f.requests[0]?.url).toBe("https://api.test/products/product/try-on?bodyId=body");
      await expect(f.requests[0]?.clone().json()).resolves.toEqual({ variantId: "variant-m" });
    },
  );
  it("offers no alternative when the shop sells no size in that direction", async () => {
    const f = fixture(() =>
      Response.json(
        {
          kind: "try-on-size-rejected",
          title: "Size rejected",
          reason: "garment_too_small",
          tryOnId: "try-on",
          variantId: "variant-xl",
        },
        { status: 422 },
      ),
    );
    await expect(
      f.client.tryOn.createTryOn({ session, bodyId, productId, variantId: "variant-xl" }),
    ).resolves.toEqual({
      ok: true,
      data: { status: "error", reason: { kind: "garment_too_small", recommendedSize: "" } },
    });
  });
  it("names a rejected waist × length size by its size key", async () => {
    const f = fixture(() =>
      Response.json(
        {
          kind: "try-on-size-rejected",
          title: "Size rejected",
          reason: "garment_too_small",
          tryOnId: "try-on",
          recommendedForeignIds: { style: "32", size: "30" },
        },
        { status: 422 },
      ),
    );
    await expect(
      f.client.tryOn.createTryOn({ session, bodyId, productId, variantId: "variant-m" }),
    ).resolves.toEqual({
      ok: true,
      data: { status: "error", reason: { kind: "garment_too_small", recommendedSize: "30 / 32" } },
    });
  });
  it("keeps the variant a completed try-on reports", async () => {
    const f = fixture(() =>
      Response.json(
        {
          tryOnId: "try-on",
          status: "completed",
          variantId: "variant-m",
          imageUrl: "https://images.test/try-on.jpg",
          scene: { overlayColor: "#ffffff" },
        },
        { status: 201 },
      ),
    );
    await expect(
      f.client.tryOn.createTryOn({ session, bodyId, productId, variantId: "variant-m" }),
    ).resolves.toMatchObject({ ok: true, data: { status: "success", variantId: "variant-m" } });
  });
  it("requests recommendations from the product resource and keys them by size", async () => {
    const f = fixture(() =>
      Response.json({
        recommendedForeignIds: { size: "32", style: "30" },
        recommendations: [
          {
            foreignIds: { size: "32", style: "30" },
            rank: 1,
            rationale: "Fits",
            fit: "ideal",
            fitMatch: 92,
            fitChecks: [],
          },
          {
            foreignIds: { size: "30", style: "30" },
            rank: 2,
            rationale: "Tight",
            fit: "runs_tight",
            fitMatch: 60,
            fitChecks: [],
            gate: "too_small",
          },
        ],
      }),
    );
    await expect(
      f.client.tryOn.getRecommendedSize({ session, bodyId, productId }),
    ).resolves.toEqual({
      ok: true,
      data: {
        recommendedSize: "32 / 30",
        recommendedOptions: { size: "32", style: "30" },
        recommendations: [
          {
            size: "32 / 30",
            options: { size: "32", style: "30" },
            rank: 1,
            rationale: "Fits",
            fit: "ideal",
            fitMatch: 92,
            fitChecks: [],
          },
          {
            size: "30 / 30",
            options: { size: "30", style: "30" },
            rank: 2,
            rationale: "Tight",
            fit: "runs_tight",
            fitMatch: 60,
            fitChecks: [],
            gate: "too_small",
          },
        ],
      },
    });
    expect(f.requests[0]?.url).toBe(
      "https://api.test/products/product/recommended-size?bodyId=body",
    );
  });
  it("leaves the recommended size absent when no size is eligible", async () => {
    const f = fixture(() => Response.json({ recommendations: [] }));
    await expect(
      f.client.tryOn.getRecommendedSize({ session, bodyId, productId }),
    ).resolves.toEqual({ ok: true, data: { recommendations: [] } });
  });
  it("reads a product's variants by its id and by the shop's own id", async () => {
    const details = {
      productId,
      variants: [{ id: "variant-m", foreignVariantIds: { colorway: "A100-259", size: "M" } }],
    };
    const mapped = { ok: true, data: details };
    const f = fixture(() => Response.json(details));
    await expect(f.client.catalog?.getProductDetails({ productId })).resolves.toEqual(mapped);
    await expect(f.client.catalog?.getProductByForeignId({ foreignId: "A100" })).resolves.toEqual(
      mapped,
    );
    expect(f.requests.map((request) => request.url)).toEqual([
      "https://api.test/products/product",
      "https://api.test/products/by-foreign-id/A100",
    ]);
  });
  it("reports a product the shop does not have as not found", async () => {
    const f = fixture(() =>
      Response.json({ kind: "product-not-found", title: "Product not found" }, { status: 404 }),
    );
    await expect(
      f.client.catalog?.getProductByForeignId({ foreignId: "unknown" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "not_found", details: { kind: "product-not-found" } },
    });
  });
  it("lists the shop's products as ids", async () => {
    const f = fixture(() => Response.json({ products: [{ productId: "product" }] }));
    await expect(f.client.catalog?.listProducts({})).resolves.toEqual({
      ok: true,
      data: ["product"],
    });
    expect(f.requests[0]?.url).toBe("https://api.test/products");
  });
  it("uses OFREP shop authentication, explicit false and conditional bulk results", async () => {
    const f = fixture((req) =>
      new URL(req.url).pathname.endsWith("try-on-enabled")
        ? Response.json({ key: "try-on-enabled", value: false, reason: "SPLIT" })
        : new Response(null, { status: 304, headers: { ETag: '"flags-1"' } }),
    );
    await expect(
      f.client.experiments.getTryOnDecision({ visitorId: "visitor" }),
    ).resolves.toMatchObject({
      ok: true,
      data: { enabled: false, variant: "disabled" },
    });
    await expect(
      f.client.experiments.evaluateFlagsBulk({
        context: { targetingKey: "visitor" },
        ifNoneMatch: '"flags-1"',
      }),
    ).resolves.toEqual({ ok: true, data: { notModified: true, etag: '"flags-1"' } });
    expect(f.requests[0]?.headers.get("X-API-Key")).toBe("shop-key");
    expect(f.requests[0]?.headers.has("X-Client-Api-Key")).toBe(false);
    expect(f.requests[0]?.headers.has("X-Api-Version")).toBe(false);
    expect(f.requests[0]?.headers.has("Authorization")).toBe(false);
    await expect(f.requests[0]?.clone().json()).resolves.toEqual({
      context: { targetingKey: "visitor" },
    });
  });
  it("maps unavailable health to an error and omits the version header", async () => {
    const f = fixture(() =>
      Response.json({ kind: "service-unavailable", title: "Unavailable" }, { status: 503 }),
    );
    await expect(f.client.meta.getHealth({})).resolves.toMatchObject({
      ok: false,
      error: { kind: "service_unavailable" },
    });
    expect(f.requests[0]?.url).toBe("https://api.test/health");
    expect(f.requests[0]?.headers.has("X-Api-Version")).toBe(false);
  });
  it("preserves OFREP errors instead of treating an unknown flag as off", async () => {
    const f = fixture(() =>
      Response.json({ key: "unknown", errorCode: "FLAG_NOT_FOUND" }, { status: 404 }),
    );
    await expect(
      f.client.experiments.evaluateFlag({ key: "unknown", context: {} }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "not_found", details: { errorCode: "FLAG_NOT_FOUND" } },
    });
  });
});
