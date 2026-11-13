import { afterEach, describe, expect, it, vi } from "vitest";

import { getOrCreateVisitorId } from "../src/visitor-id.js";

describe("visitor identity lifetime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("rotates across UTC midnight even in one long-lived page", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-11-06T23:59:00Z");
    vi.stubGlobal("window", {});
    const before = getOrCreateVisitorId();
    expect(getOrCreateVisitorId()).toBe(before);
    vi.advanceTimersByTime(61_000);
    expect(getOrCreateVisitorId()).not.toBe(before);
  });
  it("does not share an identifier between SSR requests", () => {
    vi.stubGlobal("window", globalThis.undefined);
    expect(getOrCreateVisitorId()).not.toBe(getOrCreateVisitorId());
  });
});
