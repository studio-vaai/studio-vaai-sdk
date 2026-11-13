import { describe, expect, it } from "vitest";

import type { BodyId, ProductId, SessionHandle } from "../src/index.js";

import { createFetchStudioVaaiClient } from "../src/index.js";

const PRODUCT = "019febf2-33be-7174-8949-6f0082b20f40" as ProductId;
const BODY = "019febf2-33be-7174-8949-6f0082b2b0d1" as BodyId;
const SESSION = "session-token" as SessionHandle;

const provenance = {
  bodyId: BODY,
  productId: PRODUCT,
  pieceId: "019febf2-33be-7174-8949-6f0082b2a001",
  sizeSlug: "m",
  bakeHash: "7a".repeat(32),
  createdAt: "2026-10-07T10:00:00Z",
};

function completed(withProvenance: boolean, seen: Request[]): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    seen.push(request);
    return Response.json(
      {
        tryOnId: "019febf2-33be-7174-8949-6f0082b2c0de",
        status: "completed",
        variantId: "variant-m",
        imageUrl: "https://s3/out.jpg",
        scene: { overlayColor: "#ffffff" },
        ...(withProvenance ? { provenance } : {}),
      },
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
}

describe("tryOn provenance", () => {
  it("asks for none by default", async () => {
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      fetch: completed(false, seen),
    });
    const result = await client.tryOn.createTryOn({
      session: SESSION,
      bodyId: BODY,
      productId: PRODUCT,
      variantId: "variant-m",
    });
    expect(new URL(seen[0]?.url ?? "").searchParams.get("bodyId")).toBe(BODY);
    expect(new URL(seen[0]?.url ?? "").searchParams.has("include")).toBe(false);
    expect(result.ok && result.data.status === "success" && "provenance" in result.data).toBe(
      false,
    );
  });

  it("asks for it and keeps it when the client opts in", async () => {
    const seen: Request[] = [];
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.example.test",
      clientApiKey: "sv_client_test",
      includeProvenance: true,
      fetch: completed(true, seen),
    });
    const result = await client.tryOn.createTryOn({
      session: SESSION,
      bodyId: BODY,
      productId: PRODUCT,
      variantId: "variant-m",
    });
    expect(new URL(seen[0]?.url ?? "").searchParams.get("include")).toBe("provenance");
    expect(result.ok && result.data.status === "success" ? result.data.provenance : null).toEqual(
      provenance,
    );
  });
});
