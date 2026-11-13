/** Thrown by the contract-only {@link createTrackingClient} stub. */
export class TrackingClientNotImplementedError extends Error {
  readonly code = "tracking_client_not_implemented" as const;

  constructor() {
    super(
      "@studio-vaai/js-tracking: createTrackingClient has no runtime implementation; use a transport like createFetchTrackingClient.",
    );
    this.name = "TrackingClientNotImplementedError";
  }
}
