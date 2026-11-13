import type { EventContext, TrackError, TrackOptions, TrackResult } from "../base.js";
import type { TrackingClient } from "../client.js";

export const DEFAULT_COLLECTOR_BASE_URL = "https://a.studio-vaai.com" as const;

export interface FetchTrackingClientConfig {
  clientApiKey: string;
  baseUrl?: string;
  sdkVersion: string;
  distinctId?: string | (() => string);
  fetch?: typeof fetch;
  defaultContext?: EventContext;
}
interface EventPayload {
  hostname?: string;
  language?: string;
  screen?: string;
  title?: string;
  url?: string;
  referrer?: string;
}
function deriveBrowserContext(): EventContext {
  const ctx: EventContext = {};
  if (typeof globalThis === "undefined") {
    return ctx;
  }
  const w = (globalThis as { window?: Window }).window;
  if (typeof w === "undefined") {
    return ctx;
  }
  const loc = w.location;
  if (typeof loc !== "undefined") {
    ctx.hostname = loc.hostname;
    ctx.url = loc.pathname;
  }
  const doc = w.document;
  if (typeof doc !== "undefined") {
    ctx.title = doc.title;
    if (doc.referrer !== "") {
      ctx.referrer = doc.referrer;
    }
  }
  const nav = w.navigator;
  if (typeof nav !== "undefined") {
    ctx.language = nav.language;
  }
  const scr = w.screen;
  if (typeof scr !== "undefined") {
    ctx.screen = `${String(scr.width)}x${String(scr.height)}`;
  }
  return ctx;
}

function mergeContext(
  base: EventContext,
  defaults?: EventContext,
  overrides?: EventContext,
): EventContext {
  return { ...base, ...defaults, ...overrides };
}

/** Keep page paths while excluding query parameters and fragments that may identify shoppers. */
function withoutURLParameters(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? "";
}

function applyContext(payload: EventPayload, ctx: EventContext): void {
  if (typeof ctx.hostname !== "undefined") {
    payload.hostname = ctx.hostname;
  }
  if (typeof ctx.language !== "undefined") {
    payload.language = ctx.language;
  }
  if (typeof ctx.screen !== "undefined") {
    payload.screen = ctx.screen;
  }
  if (typeof ctx.title !== "undefined") {
    payload.title = ctx.title;
  }
  if (typeof ctx.url !== "undefined") {
    payload.url = withoutURLParameters(ctx.url);
  }
  if (typeof ctx.referrer !== "undefined") {
    payload.referrer = withoutURLParameters(ctx.referrer);
  }
}

function networkError(message: string, details?: unknown): TrackError {
  return details === undefined
    ? { kind: "network", message }
    : { kind: "network", message, details };
}

/** Direct collector transport. Returns whether the request was queued, never delivery acknowledgement. */
export function createFetchTrackingClient(config: FetchTrackingClientConfig): TrackingClient {
  const fetchImpl =
    config.fetch ??
    (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  const endpoint = `${(config.baseUrl ?? DEFAULT_COLLECTOR_BASE_URL).replace(/\/$/, "")}/api/send`;
  return {
    trackEvent: (event, options?: TrackOptions): TrackResult => {
      if (fetchImpl === null) {
        return { ok: false, error: networkError("fetch is not available in this environment") };
      }
      const payload: EventPayload = {};
      applyContext(
        payload,
        mergeContext(deriveBrowserContext(), config.defaultContext, options?.context),
      );
      try {
        const distinctId =
          typeof config.distinctId === "function" ? config.distinctId() : config.distinctId;
        const body = JSON.stringify({
          type: "event",
          payload: {
            ...payload,
            name: event.name,
            ...(distinctId === undefined ? {} : { id: distinctId.slice(0, 50) }),
            data: { ...event.data, "sdk-version": config.sdkVersion },
          },
        });
        const request = fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Client-Api-Key": config.clientApiKey },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          keepalive: true,
          mode: "cors",
          body,
        });
        // oxlint-disable-next-line promise/prefer-await-to-then -- synchronous fire-and-forget API
        void request.catch(() => {
          /* Best effort: analytics never interrupts the host. */
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: networkError("Failed to queue analytics request", error) };
      }
    },
  };
}
