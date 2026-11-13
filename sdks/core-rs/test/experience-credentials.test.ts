import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  ApiClient,
  browserTransport,
  ExperienceCredential,
  ExperienceCredentials,
  ExperienceRequestCredential,
} from "../src/api.js";
import { initializeCore } from "../src/index.js";

describe("Rust experience credentials", () => {
  beforeAll(async () => {
    await initializeCore(
      new Uint8Array(await readFile(new URL("../dist/studio_vaai_core.wasm", import.meta.url))),
    );
  });

  it("shares a refresh and keeps existing requests pinned to their original bearer revision", async () => {
    const refreshStarted = Promise.withResolvers<boolean>();
    let resolveRefresh!: (response: Response) => void;
    // oxlint-disable-next-line eslint-plugin-promise/avoid-new -- Hold the mocked fetch until both callers join the refresh.
    const response = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshed = vi.fn<(revision: bigint) => void>();
    const refreshTokens: (string | null)[] = [];
    const readTokens: (string | null)[] = [];
    const transport = browserTransport(async (input, init) => {
      const request = new Request(input, init);
      const authorization = request.headers.get("Authorization");
      if (new URL(request.url).pathname === "/session/bearer/refresh") {
        refreshTokens.push(authorization);
        refreshStarted.resolve(true);
        return await response;
      }
      readTokens.push(authorization);
      return Response.json({ expiresAt: "2099-01-01T00:00:00Z" });
    });
    const client = new ApiClient(
      { baseUrl: "https://api.example.test", clientApiKey: "public" },
      transport,
    );
    const credentials = new ExperienceCredentials(client, {
      cookieGeneration: () => "cookie-generation",
      parseExpiryMs: (value) => Date.parse(value),
      nowMs: () => Date.now(),
      credentialRefreshed: refreshed,
    });
    const epoch = credentials.beginEstablishment();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(
      credentials.install(
        epoch,
        new ExperienceCredential.Bearer({
          token: "old",
          expiresAt: "2026-01-01T00:01:00Z",
        }),
        "cookie-generation",
      ),
    ).toBe(true);
    const original = credentials.beginRequest(transport);
    if (original === undefined || !ExperienceRequestCredential.instanceOf(original)) {
      throw new Error("The initial request was not admitted.");
    }
    const oldClient = original.client();
    const shared = [
      credentials.refreshIfNeeded(transport, now),
      credentials.refreshIfNeeded(transport, now),
    ];
    try {
      await expect(Promise.race([refreshStarted.promise, ...shared])).resolves.toBe(true);
      resolveRefresh(Response.json({ token: "new", expiresAt: "2099-01-01T00:00:00Z" }));
      await expect(Promise.all(shared)).resolves.toEqual([undefined, undefined]);
      expect(refreshTokens).toEqual(["Bearer old"]);
      expect(refreshed).toHaveBeenCalledExactlyOnceWith(1n);
      expect(original.revision()).toBe(0n);
      expect(credentials.requestIsCurrent(original)).toBe(true);
      const current = credentials.beginRequest(transport);
      if (current === undefined || !ExperienceRequestCredential.instanceOf(current)) {
        throw new Error("The refreshed request was not admitted.");
      }
      const currentClient = current.client();
      try {
        expect(current.revision()).toBe(1n);
        await oldClient.getSession();
        await currentClient.getSession();
        expect(readTokens).toEqual(["Bearer old", "Bearer new"]);
      } finally {
        if (ApiClient.instanceOf(currentClient)) {
          currentClient.uniffiDestroy();
        }
        current.uniffiDestroy();
      }
    } finally {
      resolveRefresh(Response.error());
      await Promise.allSettled(shared);
      if (ApiClient.instanceOf(oldClient)) {
        oldClient.uniffiDestroy();
      }
      original.uniffiDestroy();
      credentials.uniffiDestroy();
      client.uniffiDestroy();
    }
  });
});
