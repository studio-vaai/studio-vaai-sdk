import { describe, expect, it } from "vitest";

import type { BodyId, SessionActivity } from "../../js-client/src/index.js";

import { createFetchStudioVaaiClient } from "../../js-client/src/index.js";
import { createDebugClient } from "../src/debug-client.js";
import { projectDebugSnapshot } from "../src/debug-snapshot.js";

const fixtureFetch: typeof globalThis.fetch = async (input) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path === "/session/bearer") {
    return Response.json(
      { token: "session-secret", expiresAt: "2099-01-01T00:00:00Z" },
      { status: 201 },
    );
  }
  if (path === "/bodies") {
    return Response.json({ bodies: [] });
  }
  if (path === "/bodies/body/height") {
    return new Response(null, { status: 204 });
  }
  throw new Error("unexpected test request");
};

describe("debugger privacy", () => {
  it("retains only phase and product metadata without source references", () => {
    const snapshot = {
      value: { postCapture: { privateState: "secret" } },
      context: {
        session: "bearer-secret",
        lastCapturedImage: new Blob(["photo-payload"]),
        bodyId: "private-body",
        bodyHeightCm: 177,
        backgroundRemovedInputUrl: "https://storage.test/photo?signature=secret",
        tryOnHistoryByProduct: { private: "history" },
        product: { id: "product-123", variants: [{ attributes: { size: "m" } }] },
        selection: { size: "m" },
      },
      children: { photoUpload: { input: new Blob(["child-photo"]) } },
      matches: (pattern: unknown) =>
        typeof pattern === "object" && JSON.stringify(pattern).includes('"product"'),
    };
    const projection = projectDebugSnapshot(snapshot);
    expect(projection?.phase).toBe("product");
    expect(projection?.productId).toBe("product-123");
    expect(projection?.variantResolved).toBe("yes");
    expect(projection).not.toHaveProperty("context");
    expect(projection).not.toHaveProperty("matches");
    expect(projection).not.toHaveProperty("children");
    const encoded = JSON.stringify(projection);
    for (const secret of [
      "secret",
      "photo-payload",
      "private-body",
      "177",
      "history",
      "child-photo",
    ]) {
      expect(encoded).not.toContain(secret);
    }
    snapshot.context.product.id = "changed-product";
    expect(projection?.productId).toBe("product-123");
    expect(Object.isFrozen(projection)).toBe(true);
    expect(projectDebugSnapshot(null)).toBeNull();
  });

  it("preserves session activity observation and unsubscribe through the debug client", async () => {
    const inner = createFetchStudioVaaiClient({
      clientApiKey: "shop",
      baseUrl: "https://api.test",
      sessionTransport: "bearer",
      fetch: fixtureFetch,
    });
    const debug = createDebugClient(inner);
    const created = await debug.session.createSession({ dataProcessingConsent: true });
    if (!created.ok) {
      throw new Error("session fixture failed");
    }
    const activities: SessionActivity[] = [];
    const stop = debug.onSessionActivity?.((activity) => {
      activities.push(activity);
    });
    await debug.body.listBodies({ session: created.data.session });
    expect(activities).toEqual([]);
    const heightArgs = {
      session: created.data.session,
      bodyId: "body" as BodyId,
      heightCm: 175,
    };
    const calibrated = await debug.body.setBodyHeight(heightArgs);
    expect(calibrated.ok).toBe(true);
    expect(activities).toMatchObject([
      { session: created.data.session, phase: "started", accepted: false },
      { session: created.data.session, phase: "settled", accepted: true },
    ]);
    expect(activities[0]?.requestId).toBe(activities[1]?.requestId);
    stop?.();
    const recalibrated = await debug.body.setBodyHeight(heightArgs);
    expect(recalibrated.ok).toBe(true);
    expect(activities).toHaveLength(2);
    expect(debug.catalog).toBe(inner.catalog);
  });
});
