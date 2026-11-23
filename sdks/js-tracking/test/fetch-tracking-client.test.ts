import { afterEach, describe, expect, it, vi } from "vitest";

import { createFetchTrackingClient } from "../src/impl/fetch-tracking-client.js";

describe("collector transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the shop key and a per-event UUID without reading browser context or identifying the shopper", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const distinctId = vi.fn<() => string>(() => "visitor");
    const browserContext = vi.fn<() => never>(() => {
      throw new Error("Unexpected browser context read");
    });
    vi.stubGlobal("window", {
      get location() {
        return browserContext();
      },
    });
    const tracking = createFetchTrackingClient({
      clientApiKey: "shop-key",
      baseUrl: "https://collector.test/",
      sdkVersion: "sdk@1",
      distinctId,
      defaultContext: { hostname: "shop.test", url: "/shirt" },
      fetch,
    });
    const event = {
      name: "consent-granted",
      data: { "product-id": "p1", bodyId: "discard" },
    } as const;
    expect(tracking.trackEvent(event, { context: { url: "/private" } })).toEqual({ ok: true });
    tracking.trackEvent(event);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://collector.test/v2/events");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors",
      headers: { "Content-Type": "application/json", "X-Client-Api-Key": "shop-key" },
    });
    const body = (await new Request(url, init).json()) as { eventId: string };
    expect(body).toEqual({
      eventId: expect.stringMatching(/^[a-f\d-]{36}$/u),
      event: { name: "consent-granted", data: { "product-id": "p1" } },
    });
    const [nextUrl, nextInit] = fetch.mock.calls[1];
    const next = (await new Request(nextUrl, nextInit).json()) as { eventId: string };
    expect(next.eventId).not.toBe(body.eventId);
    expect(distinctId).not.toHaveBeenCalled();
    expect(browserContext).not.toHaveBeenCalled();
  });

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
    expect(fetch.mock.calls[0]?.[0]).toBe("https://a.studio-vaai.com/v2/events");
    await Promise.resolve();
  });
});
