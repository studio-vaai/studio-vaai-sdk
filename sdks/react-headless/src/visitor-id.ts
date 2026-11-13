function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  // Runtimes without `randomUUID` (rare): 16 random bytes as hex.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Held in memory only — never written to `localStorage`/`sessionStorage` or
// cookies. One id for the loaded SDK, bounded by the current UTC day.
let inMemoryVisitorId: string | undefined;
let visitorDay: string | undefined;

/**
 * Stable anonymous id used to bucket a visitor into the try-on experiment and
 * as the Umami distinct id.
 *
 * **In-memory only — nothing is stored on the device.** The id is stable across
 * SPA navigation within a page session (the module variable persists) but
 * resets on UTC-day change, a hard reload or a return visit. On the server (SSR) a fresh id is
 * returned per call so the shared module never leaks one request's id to
 * another.
 */
export function getOrCreateVisitorId(): string {
  // SSR / non-browser: never cache in the shared module — give each call a
  // throwaway id (it is only meaningfully used client-side anyway).
  if (typeof globalThis.window === "undefined") {
    return randomId();
  }
  const day = new Date().toISOString().slice(0, 10);
  if (visitorDay !== day) {
    visitorDay = day;
    inMemoryVisitorId = undefined;
  }
  inMemoryVisitorId ??= randomId();
  return inMemoryVisitorId;
}
