import { describe, expect, it, vi } from "vitest";

import { imageRenewal } from "../src/experience/api/image-renewal.js";

describe("image URL renewal", () => {
  it("shares renewal across consumers and aborts only when the last consumer leaves", async () => {
    const renewals = imageRenewal();
    const first = new AbortController();
    const second = new AbortController();
    const refresh = vi.fn<(signal: AbortSignal) => Promise<void>>(async (signal) => {
      const done = Promise.withResolvers<never>();
      signal.addEventListener(
        "abort",
        () => {
          done.reject(signal.reason);
        },
        { once: true },
      );
      await done.promise;
    });

    const asset = { src: "/result.webp" };
    const display = renewals.renew(asset, refresh, first.signal);
    const download = renewals.renew(asset, refresh, second.signal);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    const request = refresh.mock.calls[0][0];

    first.abort();
    await expect(display).rejects.toMatchObject({ name: "AbortError" });
    expect(request.aborted).toBe(false);

    second.abort();
    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(request.aborted).toBe(true);
  });
});
