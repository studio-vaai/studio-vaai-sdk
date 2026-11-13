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

/**
 * Ambient page/session metadata that decorates every event. Mirrors the Umami
 * `/api/send` payload. The fetch transport strips URL query strings and fragments.
 *
 * Browser transports auto-populate these from `window`/`document`/`navigator`
 * when fields are absent; pass overrides via {@link TrackOptions.context} for
 * SSR, web workers, or tests.
 */
export interface EventContext {
  /** Page path or URL, e.g. `/products/abc`. The fetch transport strips query strings and fragments. */
  url?: string;
  /** Document title. */
  title?: string;
  /** Hostname seen by the visitor, e.g. `shop.example.com`. */
  hostname?: string;
  /** Referring page URL. The fetch transport strips query strings and fragments. */
  referrer?: string;
  /** BCP-47 language tag, e.g. `en-US`. */
  language?: string;
  /** Screen size as `"<width>x<height>"`, e.g. `"1920x1080"`. */
  screen?: string;
}

export interface TrackOptions {
  /**
   * Per-call overrides merged on top of whatever the transport auto-derives.
   * Use this to attach SSR-known values or to scrub a field for a single event.
   */
  context?: EventContext;
}
