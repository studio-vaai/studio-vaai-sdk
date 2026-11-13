import { describe, expect, it, vi } from "vitest";

import { createFetchStudioVaaiClient } from "../src/index.js";

describe("analytics factory", () => {
  it("creates the collector transport locally using the existing client key and fetch", () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.test",
      analyticsBaseUrl: "https://analytics.test",
      clientApiKey: "shop-key",
      fetch,
    });
    const tracking = client.analytics.createTrackingClient({
      sdkVersion: "test@1",
      distinctId: "visitor",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(tracking.trackEvent({ name: "consent-granted", data: { "product-id": "p1" } })).toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://analytics.test/api/send",
      expect.objectContaining({
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-Client-Api-Key": "shop-key" },
      }),
    );
  });
});
