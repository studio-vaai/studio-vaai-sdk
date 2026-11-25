import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TRY_ON_HISTORY_LIMIT, tryOnHistoryStore } from "../src/experience/api/try-on-history.js";

const tryOn = (n: number) => ({
  tryOnId: `try-on-${n}`,
  productId: "shirt",
  variantId: `variant-${n}`,
  backendRevision: "rev-1",
});

describe("try-on history", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a body's try-ons in order, capped, and forgets them for another body", async () => {
    const history = await tryOnHistoryStore("https://api.example.test/", "key");
    for (let n = 0; n < TRY_ON_HISTORY_LIMIT + 2; n += 1) {
      history.remember("body-1", tryOn(n));
    }
    history.remember("body-1", tryOn(5));
    const kept = history.of("body-1");
    expect(kept).toHaveLength(TRY_ON_HISTORY_LIMIT);
    expect(kept.at(0)?.tryOnId).toBe("try-on-2");
    expect(kept.at(-1)?.tryOnId).toBe("try-on-5");
    // A reload builds a new store over the same storage.
    const reloaded = await tryOnHistoryStore("https://api.example.test", "key");
    expect(reloaded.of("body-1")).toEqual(kept);
    expect(reloaded.of("body-2")).toEqual([]);
    reloaded.forget("try-on-5");
    expect(reloaded.of("body-1").map(({ tryOnId }) => tryOnId)).not.toContain("try-on-5");
    reloaded.remember("body-2", tryOn(99));
    expect(reloaded.of("body-1")).toEqual([]);
    reloaded.clear();
    expect(reloaded.of("body-2")).toEqual([]);
  });

  it("keeps nothing when storage fails", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    const history = await tryOnHistoryStore("https://api.example.test", "key");
    history.remember("body-1", tryOn(1));
    expect(history.of("body-1")).toEqual([]);
  });
});
