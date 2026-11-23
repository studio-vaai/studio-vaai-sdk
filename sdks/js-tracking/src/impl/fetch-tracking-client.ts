import type { EventContext, TrackError, TrackResult } from "../base.js";
import type { TrackingClient } from "../client.js";
import type { TrackingEvent } from "../events.js";

export const DEFAULT_COLLECTOR_BASE_URL = "https://a.studio-vaai.com" as const;

export interface FetchTrackingClientConfig {
  clientApiKey: string;
  baseUrl?: string;
  /** Compatibility option. Cookieless analytics does not attach an SDK version. */
  sdkVersion?: string;
  /** Compatibility option. The transport ignores visitor identifiers. */
  distinctId?: string | (() => string);
  fetch?: typeof fetch;
  /** Compatibility option. The transport ignores browser context. */
  defaultContext?: EventContext;
}
const axes = [
  "variant-id",
  "variant-size",
  "variant-colorway",
  "variant-waist",
  "variant-length",
] as const;

type WireData = Record<string, string | number | boolean>;

function eventForCollector(event: TrackingEvent): { name: string; data: WireData } {
  const fields = event.data;
  if (event.name === "experiment-assigned") {
    return {
      name: event.name,
      data: { experiment: event.data.experiment, variant: event.data.variant },
    };
  }
  const data: WireData = { "product-id": event.data["product-id"] };
  const copy = (...keys: string[]) => {
    for (const key of keys) {
      const value: unknown = Reflect.get(fields, key);
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        data[key] = value;
      }
    }
  };
  // oxlint-disable-next-line eslint/default-case -- The event union is exhaustive.
  switch (event.name) {
    case "entrypoint-impression":
    case "entrypoint-clicked":
    case "widget-opened": {
      copy("entry");
      break;
    }
    case "intro-opened":
    case "height-step-opened":
    case "image-record-initiated":
    case "image-record-aborted":
    case "image-upload-initiated":
    case "image-upload-aborted": {
      copy("source");
      break;
    }
    case "height-entered": {
      // Older subscribers use this name on entry to the height step.
      if ("source" in event.data) {
        copy("source");
        return { name: "height-step-opened", data };
      }
      break;
    }
    case "image-uploaded": {
      copy("image-source");
      break;
    }
    case "photo-rejected": {
      copy("method");
      break;
    }
    case "variant-selection-initiated": {
      copy("source", "via");
      break;
    }
    case "try-on-initiated": {
      copy("origin", ...axes);
      break;
    }
    case "variant-changed":
    case "try-on-presented":
    case "cart-requested":
    case "cart-item-added":
    case "order-placed": {
      copy(...axes);
      break;
    }
    case "view-closed": {
      copy("current-step", "result-displayed");
      break;
    }
    case "experience-summary": {
      copy(
        "entry",
        "reached-intro",
        "granted-consent",
        "accepted-photo",
        "confirmed-height",
        "reached-selection",
        "requested-try-on",
        "presented-result",
        "requested-cart",
        "try-on-count",
        "distinct-sizes",
        "distinct-colors",
        "distinct-waists",
        "distinct-lengths",
        "time-to-result",
      );
      break;
    }
    case "consent-granted":
    case "gated-size-selected": {
      break;
    }
  }
  return { name: event.name, data };
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
  const endpoint = `${(config.baseUrl ?? DEFAULT_COLLECTOR_BASE_URL).replace(/\/$/, "")}/v2/events`;
  return {
    trackEvent: (event): TrackResult => {
      if (fetchImpl === null) {
        return { ok: false, error: networkError("fetch is not available in this environment") };
      }
      try {
        const { name, data } = eventForCollector(event);
        const body = JSON.stringify({ eventId: crypto.randomUUID(), event: { name, data } });
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
