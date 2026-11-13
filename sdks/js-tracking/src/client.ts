import type { TrackOptions, TrackResult } from "./base.js";
import type { TrackingEvent } from "./events.js";

import { TrackingClientNotImplementedError } from "./errors.js";

/** Npm package id. */
export const SDK_PACKAGE_ID = "@studio-vaai/js-tracking" as const;

/** Marker config every transport extends. */
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- Intentional open transport marker.
export type TrackingClientConfig = Record<never, never>;

/**
 * Transport-agnostic event sender. Implementations live under `impl/` (e.g.
 * the collector transport) — consumers depend on this interface so the
 * underlying analytics backend can be swapped without touching call sites.
 */
export interface TrackingClient {
  /**
   * Send a single typed event. Synchronous and fire-and-forget —
   * implementations dispatch via `fetch` with `keepalive: true`. Returns a
   * {@link TrackResult} reflecting whether the event was successfully queued
   * for delivery, NOT whether the server acknowledged it. Never throws —
   * analytics must not break the host app.

   */
  trackEvent(event: TrackingEvent, options?: TrackOptions): TrackResult;
}

/** Contract-only stub — throws; a transport package supplies a real implementation. */
export function createTrackingClient(_config: TrackingClientConfig): TrackingClient {
  throw new TrackingClientNotImplementedError();
}
