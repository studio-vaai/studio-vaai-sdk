import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalStorageSessionPersistence,
  SESSION_IDLE_MS,
} from "../src/session-persistence.js";
import { testSession } from "./helpers.js";

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

describe("persisted session expiry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("expires without extending its deadline on reads", () => {
    vi.useFakeTimers();
    const values = storage();
    const adapter = createLocalStorageSessionPersistence("session");
    adapter.write(testSession);
    vi.advanceTimersByTime(SESSION_IDLE_MS - 1);
    expect(adapter.read()).toBe(testSession);
    vi.advanceTimersByTime(1);
    expect(adapter.read()).toBeUndefined();
    expect(values.has("session")).toBe(false);
  });
  it("honours an earlier authoritative expiry and discards undated legacy handles", () => {
    vi.useFakeTimers();
    const values = storage();
    const adapter = createLocalStorageSessionPersistence("session");
    values.set("session", testSession);
    expect(adapter.read()).toBeUndefined();
    adapter.write(testSession, Date.now() + 10);
    vi.advanceTimersByTime(10);
    expect(adapter.read()).toBeUndefined();
  });
});
