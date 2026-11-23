export type TrackErrorKind = "network" | "rejected" | "unknown";

export interface TrackError {
  kind: TrackErrorKind;
  message: string;
  details?: unknown;
}

export interface TrackSuccess {
  ok: true;
}

export interface TrackFailure {
  ok: false;
  error: TrackError;
}

/**
 * Fire-and-mostly-forget result. Tracking is best-effort: callers should not
 * branch product behaviour on `ok`, but may surface a warning in dev.
 *
 * Returned synchronously from {@link TrackingClient.trackEvent} — reflects
 * whether the event was queued for delivery via keepalive fetch, not whether
 * the server received it.
 */
export type TrackResult = TrackSuccess | TrackFailure;

/** Optional metadata for custom tracking clients. The collector transport ignores it. */
export interface EventContext {
  /** Page path or URL, e.g. `/products/abc`. */
  url?: string;
  /** Document title. */
  title?: string;
  /** Hostname seen by the visitor, e.g. `shop.example.com`. */
  hostname?: string;
  /** Referring page URL. */
  referrer?: string;
  /** BCP-47 language tag, e.g. `en-US`. */
  language?: string;
  /** Screen size as `"<width>x<height>"`, e.g. `"1920x1080"`. */
  screen?: string;
}

export interface TrackOptions {
  /** Optional metadata passed to a custom tracking client. */
  context?: EventContext;
}
