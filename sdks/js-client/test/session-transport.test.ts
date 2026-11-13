import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFetchStudioVaaiClient,
  type SessionTransportPreference,
  type SessionHandle,
  type BodyId,
  type SessionActivity,
} from "../src/index.js";

const EXPIRY = "2026-12-01T12:00:00Z";
function fixture(
  options: {
    mode?: SessionTransportPreference;
    browser?: boolean;
    cookieError?: string;
    preparationError?: number | "network";
    verificationError?: boolean;
    exposeToken?: boolean;
  } = {},
) {
  if (options.browser !== false) {
    vi.stubGlobal("document", {});
  }
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    requests.push(req);
    const path = new URL(req.url).pathname;
    if (path === "/session/cookie/prepare") {
      if (options.preparationError === "network") {
        throw new TypeError("Failed to fetch");
      }
      if (typeof options.preparationError === "number") {
        return Response.json(
          { kind: "session-preparation-failed", title: "Preparation failed" },
          { status: options.preparationError },
        );
      }
      return Response.json({ challenge: "challenge-123" });
    }
    if (path === "/session/cookie") {
      if (typeof options.cookieError === "string") {
        return Response.json(
          { kind: options.cookieError, title: "Cookie creation failed" },
          { status: 400 },
        );
      }
      return Response.json(
        { expiresAt: EXPIRY, ...(options.exposeToken === true ? { token: "secret" } : {}) },
        { status: 201 },
      );
    }
    if (path === "/session/bearer") {
      return Response.json({ token: "bearer", expiresAt: EXPIRY }, { status: 201 });
    }
    if (path === "/session/cookie/refresh") {
      return Response.json({ expiresAt: EXPIRY });
    }
    if (path === "/session/bearer/refresh") {
      return Response.json({ token: "rotated-bearer", expiresAt: EXPIRY });
    }
    if (path === "/session") {
      if (req.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (options.verificationError === true) {
        return Response.json(
          { kind: "session-token-required", title: "Cookie unavailable" },
          { status: 401 },
        );
      }
      return Response.json({ expiresAt: EXPIRY });
    }
    if (path === "/bodies") {
      return Response.json({ bodies: [] });
    }
    if (path === "/bodies/body/height") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  const config = {
    baseUrl: "https://api.test",
    clientApiKey: "shop",
    fetch,
    ...(options.mode ? { sessionTransport: options.mode } : {}),
  };
  return {
    client: createFetchStudioVaaiClient(config),
    config,
    requests,
    paths: () => requests.map((r) => new URL(r.url).pathname),
  };
}
describe("split session transports", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("attributes cookie business activity to its handle without an engagement header", async () => {
    const f = fixture({ mode: "cookie" });
    const activity: SessionActivity[] = [];
    f.client.onSessionActivity?.((event) => activity.push(event));
    const created = await f.client.session.createSession({ dataProcessingConsent: true });
    if (!created.ok) {
      throw new Error("Expected cookie session");
    }
    expect(activity).toEqual([]);
    const session = created.data.session;
    const result = await f.client.body.setBodyHeight({
      session,
      bodyId: "body" as BodyId,
      heightCm: 175,
    });
    expect(result.ok).toBe(true);
    expect(activity).toMatchObject([
      { session, phase: "started", accepted: false },
      { session, phase: "settled", accepted: true },
    ]);
    const request = f.requests.at(-1);
    expect(request?.credentials).toBe("include");
    expect(request?.headers.has("Authorization")).toBe(false);
    expect(request?.headers.has("X-Vaai-User-Engagement")).toBe(false);
  });

  it("creates bearer sessions without preparing or sending cookies", async () => {
    const f = fixture({ mode: "bearer" });
    const r = await f.client.session.createSession({ dataProcessingConsent: true });
    expect(r).toMatchObject({ ok: true, data: { session: "bearer", sessionTransport: "bearer" } });
    expect(f.paths()).toEqual(["/session/bearer"]);
    expect(f.requests[0]?.credentials).toBe("omit");
    await expect(f.requests[0]?.clone().json()).resolves.toEqual({ dataProcessingConsent: true });
  });
  it("prepares, creates and verifies the actual cookie session", async () => {
    const f = fixture();
    const r = await f.client.session.createSession({ dataProcessingConsent: true });
    expect(r).toMatchObject({ ok: true, data: { sessionTransport: "cookie" } });
    expect(f.paths()).toEqual(["/session/cookie/prepare", "/session/cookie", "/session"]);
    expect(f.requests[0]?.body).toBeNull();
    await expect(f.requests[1]?.clone().json()).resolves.toEqual({
      dataProcessingConsent: true,
      cookieChallenge: "challenge-123",
    });
    expect(
      f.requests.every(
        (r) =>
          r.credentials === "include" &&
          !r.headers.has("Authorization") &&
          !r.headers.has("Cookie"),
      ),
    ).toBe(true);
  });
  it("auto falls back only on the explicit unavailable response", async () => {
    const f = fixture({ cookieError: "session-cookie-unavailable" });
    await expect(
      f.client.session.createSession({ dataProcessingConsent: true }),
    ).resolves.toMatchObject({
      ok: true,
      data: { sessionTransport: "bearer" },
    });
    expect(f.paths()).toEqual(["/session/cookie/prepare", "/session/cookie", "/session/bearer"]);
  });
  it.each(["session-preparation-invalid", "invalid-request"])(
    "does not fall back for %s",
    async (cookieError) => {
      const f = fixture({ cookieError });
      await expect(
        f.client.session.createSession({ dataProcessingConsent: true }),
      ).resolves.toMatchObject({
        ok: false,
      });
      expect(f.paths()).not.toContain("/session/bearer");
    },
  );
  it.each(["network", 400, 403, 500, 503] as const)(
    "does not fall back after preparation failure %s",
    async (preparationError) => {
      const f = fixture({ preparationError });
      await expect(
        f.client.session.createSession({ dataProcessingConsent: true }),
      ).resolves.toMatchObject({
        ok: false,
      });
      expect(f.paths()).toEqual(["/session/cookie/prepare"]);
    },
  );
  it("cookie-only mode reports unavailability without bearer creation", async () => {
    const f = fixture({ mode: "cookie", cookieError: "session-cookie-unavailable" });
    await expect(
      f.client.session.createSession({ dataProcessingConsent: true }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: "session_transport_unavailable" },
    });
    expect(f.paths()).not.toContain("/session/bearer");
  });
  it("does not fall back after actual session verification fails", async () => {
    const f = fixture({ verificationError: true });
    await expect(
      f.client.session.createSession({ dataProcessingConsent: true }),
    ).resolves.toMatchObject({
      ok: false,
    });
    expect(f.paths()).not.toContain("/session/bearer");
  });
  it("rejects a cookie response exposing a credential", async () => {
    const f = fixture({ exposeToken: true });
    await expect(
      f.client.session.createSession({ dataProcessingConsent: true }),
    ).resolves.toMatchObject({
      ok: false,
    });
    expect(f.paths()).not.toContain("/session/bearer");
  });
  it("native auto mode creates bearer directly", async () => {
    const f = fixture({ browser: false });
    await expect(
      f.client.session.createSession({ dataProcessingConsent: true }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(f.paths()).toEqual(["/session/bearer"]);
  });
  it("restores, refreshes and deletes cookies without exposing credentials", async () => {
    const f = fixture({ mode: "cookie" });
    const r = await f.client.session.createSession({ dataProcessingConsent: true });
    if (!r.ok) {
      throw new Error("cookie creation");
    }
    const restored = createFetchStudioVaaiClient(f.config);
    await expect(restored.body.listBodies({ session: r.data.session })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      restored.session.refreshSession({ session: r.data.session }),
    ).resolves.toMatchObject({
      ok: true,
      data: { session: r.data.session },
    });
    await expect(
      restored.session.invalidateSession({ session: r.data.session }),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(f.paths()).toContain("/session/cookie/refresh");
    expect(
      f.requests.every((r) => !r.headers.has("Authorization") && !r.headers.has("Cookie")),
    ).toBe(true);
    const other = createFetchStudioVaaiClient({ ...f.config, clientApiKey: "different" });
    const count = f.requests.length;
    await expect(other.session.getSession({ session: r.data.session })).resolves.toMatchObject({
      ok: false,
    });
    expect(f.requests).toHaveLength(count);
  });
  it("refreshes bearer credentials through their own endpoint", async () => {
    const f = fixture();
    await expect(
      f.client.session.refreshSession({ session: "old" as SessionHandle }),
    ).resolves.toMatchObject({ ok: true, data: { session: "rotated-bearer" } });
    expect(f.paths()).toEqual(["/session/bearer/refresh"]);
    expect(f.requests[0]?.headers.get("Authorization")).toBe("Bearer old");
  });
  it("requires consent before issuing any requests", async () => {
    const f = fixture();
    await expect(
      f.client.session.createSession({ dataProcessingConsent: false }),
    ).resolves.toMatchObject({
      ok: false,
    });
    expect(f.requests).toHaveLength(0);
  });
});
