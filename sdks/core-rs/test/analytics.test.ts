import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";

import manifest from "../package.json";
import { createTryOnAnalytics } from "../src/analytics/index.js";
import { initializeCore } from "../src/runtime.js";

describe("collector analytics", () => {
  beforeAll(async () => {
    await initializeCore(await readFile(new URL("../dist/studio_vaai_core.wasm", import.meta.url)));
  });

  it("sends the generated catalogue body to the collector without shopper credentials", async () => {
    const requests: Request[] = [];
    const sdkVersion = `${manifest.name}@${manifest.version}`;
    const publisher = createTryOnAnalytics({
      clientApiKey: "public-shop-key",
      baseUrl: "https://collector.example.test",
      enabled: () => true,
      visitorId: () => "visitor",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(null, { status: 204 });
      },
    });
    const foreignIds = { size: "28", inseam: "32", colorway: "blue" };
    publisher.observe((listener) => {
      listener({
        type: "sv-try-on-requested",
        detail: {
          productId: "shirt",
          step: "try-on",
          origin: "shopper",
          variantId: "v",
          requestId: "r",
          foreignIds,
        },
      });
      listener({
        type: "sv-try-on-add-to-cart-requested",
        detail: { productId: "shirt", step: "try-on", variantId: "v", foreignIds },
      });
      return () => {
        // The test source has no active subscription to release.
      };
    });

    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const request = requests[0];
    expect(request.url).toBe("https://collector.example.test/api/send");
    expect(request.credentials).toBe("omit");
    expect(request.keepalive).toBe(true);
    expect(request.headers.get("X-Client-Api-Key")).toBe("public-shop-key");
    expect(request.headers.has("Authorization")).toBe(false);
    expect(request.headers.has("X-Client-Version")).toBe(false);
    await expect(request.json()).resolves.toEqual({
      type: "event",
      payload: {
        id: "visitor",
        name: "try-on-initiated",
        data: {
          "product-id": "shirt",
          "sdk-version": sdkVersion,
          "variant-size": "28",
          "variant-inseam": "32",
          "variant-colorway": "blue",
        },
      },
    });
    publisher.experimentAssigned(true);
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    await expect(requests[1]?.json()).resolves.toEqual({
      type: "event",
      payload: {
        id: "visitor",
        name: "experiment-assigned",
        data: { experiment: "try-on-enabled", variant: "enabled", "sdk-version": sdkVersion },
      },
    });
    publisher.observe((listener) => {
      listener({
        type: "sv-try-on-height-failed",
        detail: { productId: "shirt", step: "height", reason: "unavailable" },
      });
      listener({
        type: "sv-try-on-operation-uncertain",
        detail: { productId: "shirt", step: "try-on", work: "try-on" },
      });
      listener({
        type: "sv-try-on-picker-failed",
        detail: { productId: "shirt", step: "intro", reason: "unavailable" },
      });
      listener({
        type: "sv-try-on-capture-failed",
        detail: { productId: "shirt", step: "camera", reason: "failed" },
      });
      return () => {
        // The test source has no active subscription to release.
      };
    });
    await vi.waitFor(() => {
      expect(requests).toHaveLength(6);
    });
    const failures = await Promise.all(
      requests.slice(2).map(async (request): Promise<unknown> => await request.json()),
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            name: "experience-operation-failed",
            data: expect.objectContaining({
              work: "height",
              outcome: "failed",
              reason: "unavailable",
              "current-step": "height",
            }),
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            name: "experience-operation-failed",
            data: expect.objectContaining({ work: "try-on", outcome: "uncertain" }),
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            name: "experience-operation-failed",
            data: expect.objectContaining({ work: "picker", outcome: "failed" }),
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            name: "experience-operation-failed",
            data: expect.objectContaining({ work: "capture", outcome: "failed" }),
          }),
        }),
      ]),
    );
    publisher.dispose();
  });
});
