import { describe, expect, it, vi } from "vitest";

import { browserTransport } from "../src/browser-transport.js";

describe("browser transport", () => {
  it("reports an already-cancelled write as unsent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const signal = AbortSignal.abort();
    const transport = browserTransport(fetch);
    await expect(
      transport.send(
        {
          url: "https://api.example.test/body",
          method: "PATCH",
          headers: [],
          withCredentials: true,
        },
        { signal },
      ),
    ).rejects.toMatchObject({ tag: "NotSent" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels a response body that stalls after returning headers", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<boolean>();
    const transport = browserTransport(async () => {
      await Promise.resolve();
      return new Response(
        new ReadableStream({
          pull() {
            started.resolve(true);
          },
        }),
      );
    });
    const pending = transport.send(
      {
        url: "https://api.example.test/session",
        method: "GET",
        headers: [],
        withCredentials: true,
      },
      { signal: controller.signal },
    );
    await started.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      inner: { reason: "The API request did not complete." },
    });
  });
});
