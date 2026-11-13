import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventContext } from "../src/base.js";

import { createFetchTrackingClient } from "../src/impl/fetch-tracking-client.js";

describe("collector transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends immediately with the shop key, visitor and context, without website configuration", () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const tracking = createFetchTrackingClient({
      clientApiKey: "shop-key",
      baseUrl: "https://collector.test/",
      sdkVersion: "sdk@1",
      distinctId: "visitor",
      defaultContext: { hostname: "shop.test", url: "/shirt" },
      fetch,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(tracking.trackEvent({ name: "consent-granted", data: { "product-id": "p1" } })).toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://collector.test/api/send");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors",
      headers: { "Content-Type": "application/json", "X-Client-Api-Key": "shop-key" },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      type: "event",
      payload: {
        name: "consent-granted",
        hostname: "shop.test",
        url: "/shirt",
        id: "visitor",
        data: { "product-id": "p1", "sdk-version": "sdk@1" },
      },
    });
  });

  it("excludes query strings and fragments from browser page and referrer context", () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "shop.test",
        pathname: "/products/shirt",
        search: "?email=shopper%40example.test",
        hash: "#session-token",
      },
      document: {
        title: "Shirt",
        referrer: "https://shop.test/account?email=shopper%40example.test#session-token",
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const tracking = createFetchTrackingClient({ clientApiKey: "key", sdkVersion: "test", fetch });
    tracking.trackEvent({ name: "consent-granted", data: { "product-id": "p1" } });
    const init = fetch.mock.calls[0][1]!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      payload: {
        hostname: "shop.test",
        url: "/products/shirt",
        title: "Shirt",
        referrer: "https://shop.test/account",
      },
    });
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.body).not.toContain("shopper");
    expect(init.body).not.toContain("session-token");
  });

  it.each(["defaults", "event"] as const)(
    "also scrubs URLs supplied through %s context",
    (source) => {
      const context: EventContext = {
        url: "https://shop.test/products/shirt?email=shopper%40example.test#session-token",
        referrer: "/collections/summer#customer-id?email=shopper%40example.test",
      };
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }));
      const tracking = createFetchTrackingClient({
        clientApiKey: "key",
        sdkVersion: "test",
        fetch,
        ...(source === "defaults" ? { defaultContext: context } : {}),
      });
      tracking.trackEvent(
        { name: "consent-granted", data: { "product-id": "p1" } },
        source === "event" ? { context } : undefined,
      );
      const init = fetch.mock.calls[0][1]!;
      expect(JSON.parse(init.body as string)).toMatchObject({
        payload: { url: "https://shop.test/products/shirt", referrer: "/collections/summer" },
      });
      expect(init.body).not.toContain("shopper");
      expect(init.body).not.toContain("session-token");
      expect(init.body).not.toContain("customer-id");
    },
  );
  it("handles synchronous fetch failure without throwing", () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      throw new Error("offline");
    });
    expect(
      createFetchTrackingClient({ clientApiKey: "key", sdkVersion: "test", fetch }).trackEvent({
        name: "consent-granted",
        data: { "product-id": "p1" },
      }).ok,
    ).toBe(false);
  });
  it("absorbs asynchronous failure and uses the shared collector by default", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    expect(
      createFetchTrackingClient({ clientApiKey: "key", sdkVersion: "test", fetch }).trackEvent({
        name: "consent-granted",
        data: { "product-id": "p1" },
      }),
    ).toEqual({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe("https://a.studio-vaai.com/api/send");
    await Promise.resolve();
  });
});
