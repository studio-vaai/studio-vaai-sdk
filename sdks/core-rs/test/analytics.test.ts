import { describe, expect, it, vi } from "vitest";

import type { TryOnExperienceEvent } from "../src/experience/events.js";

import { createTryOnAnalytics } from "../src/analytics/index.js";

describe("collector analytics", () => {
  it("projects lifecycle facts to cookieless occurrences and one bounded summary", async () => {
    const requests: Request[] = [];
    const visitorId = vi.fn<() => string>(() => "private-visitor");
    const publisher = createTryOnAnalytics({
      clientApiKey: "public-shop-key",
      baseUrl: "https://collector.example.test",
      enabled: () => true,
      visitorId,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(null, { status: 204 });
      },
    });
    const product = { productId: "shirt", step: "try-on" } as const;
    const variant = {
      variantId: "v",
      foreignIds: { size: "28", waist: "28", length: "32", colorway: "blue" },
    };
    const requested = {
      ...product,
      ...variant,
      requestId: "private-request",
      origin: "shopper",
    } as const;
    const displayed = { tryOnId: "private-result", variantId: "v" };
    const facts: TryOnExperienceEvent[] = [
      { type: "sv-try-on-opened", detail: { ...product, step: "intro", entry: "pdp" } },
      {
        type: "sv-try-on-step-changed",
        detail: { ...product, step: "height", previousStep: "photo-upload" },
      },
      { type: "sv-try-on-height-confirmed", detail: { ...product, step: "height" } },
      { type: "sv-try-on-variant-changed", detail: { ...product, ...variant } },
      { type: "sv-try-on-requested", detail: requested },
      { type: "sv-try-on-rendered", detail: { ...product, ...displayed } },
      { type: "sv-try-on-presented", detail: { ...product, ...displayed } },
      { type: "sv-try-on-presented", detail: { ...product, ...displayed } },
      { type: "sv-try-on-add-to-cart-requested", detail: { ...product, ...variant } },
      { type: "sv-try-on-closed", detail: { ...product, displayed } },
    ];
    publisher.observe((listener) => {
      for (const fact of facts) {
        listener(fact);
      }
      return () => {
        // The fixture sends its events synchronously.
      };
    });

    expect(visitorId).not.toHaveBeenCalled();
    expect(requests[0]?.url).toBe("https://collector.example.test/v2/events");
    expect(requests[0]?.credentials).toBe("omit");
    expect(requests[0]?.referrerPolicy).toBe("no-referrer");
    expect(requests[0]?.headers.get("X-Client-Api-Key")).toBe("public-shop-key");
    const bodies = await Promise.all(
      requests.map(
        async (req) =>
          (await req.json()) as {
            eventId: string;
            event: { name: string; data: Record<string, unknown> };
          },
      ),
    );
    expect(new Set(bodies.map((body) => body.eventId)).size).toBe(bodies.length);
    expect(bodies.map((body) => body.event.name)).toEqual([
      "widget-opened",
      "entrypoint-clicked",
      "height-step-opened",
      "height-entered",
      "variant-changed",
      "try-on-initiated",
      "try-on-presented",
      "cart-requested",
      "view-closed",
      "experience-summary",
    ]);
    expect(bodies.at(-1)?.event.data).toMatchObject({
      "reached-intro": true,
      "confirmed-height": true,
      "presented-result": true,
      "requested-cart": true,
      "try-on-count": 1,
      "distinct-colors": 1,
      "distinct-sizes": 1,
      "distinct-waists": 1,
      "distinct-lengths": 1,
      "time-to-result": "lt-10s",
    });
    expect(JSON.stringify(bodies)).not.toMatch(/private-(visitor|request|result)/);
  });

  it("honors the enabled callback and disposal before sending", () => {
    let enabled = false;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const publisher = createTryOnAnalytics({ clientApiKey: "key", enabled: () => enabled, fetch });
    publisher.entrypointImpression("p", "pdp");
    expect(fetch).not.toHaveBeenCalled();
    enabled = true;
    publisher.experimentAssigned(true);
    expect(fetch).toHaveBeenCalledOnce();
    publisher.dispose();
    publisher.entrypointImpression("p", "pdp");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
