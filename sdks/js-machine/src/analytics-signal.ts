import type { ImageFlowSource, Step, VariantSelectionVia } from "@studio-vaai/js-tracking";

/**
 * Partial analytics signals emitted by the machine via XState `emit(...)`.
 * Each variant carries the fields the machine knows intrinsically; host-
 * derivable fields (`source` on step-transition events, `current-step`) are
 * filled in by the `createTrackingSubscriber` bridge. Image upload/capture
 * events carry an explicit {@link ImageFlowSource} `source` set by the host
 * at picker/camera open time.
 *
 * The `type` discriminator matches XState's emitted-event convention; the
 * bridge maps each `type` to a `TrackingEvent` (which uses `name`).
 *
 * Kept in its own leaf file so the machine and the bridge can both depend on
 * it without forming a cycle.
 */
export type AnalyticsSignal =
  | { readonly type: "intro-opened"; readonly "product-id": string }
  | { readonly type: "consent-granted"; readonly "product-id": string }
  | {
      readonly type: "image-record-initiated";
      readonly "product-id": string;
      readonly source: ImageFlowSource;
    }
  | {
      readonly type: "image-record-aborted";
      readonly "product-id": string;
      readonly source: ImageFlowSource;
    }
  | {
      readonly type: "image-upload-initiated";
      readonly "product-id": string;
      readonly source: ImageFlowSource;
    }
  | {
      readonly type: "image-upload-aborted";
      readonly "product-id": string;
      readonly source: ImageFlowSource;
    }
  | {
      readonly type: "image-uploaded";
      readonly "product-id": string;
      /** Raw machine value; the bridge maps to the event spec's `image-source`. */
      readonly "photo-source": "camera" | "gallery";
    }
  | { readonly type: "height-entered"; readonly "product-id": string }
  | {
      readonly type: "variant-selection-initiated";
      readonly "product-id": string;
      readonly via?: VariantSelectionVia;
    }
  | {
      readonly type: "try-on-initiated";
      readonly "product-id": string;
      /** Flat axis-name → value map (e.g. `{ colorway: "A100-259", size: "M" }`). The
       * bridge flattens to `variant-<axis>` wire keys. */
      readonly variants: Readonly<Record<string, string>>;
    }
  | {
      /** The shopper deliberately picked a size the fit gate marks unwearable
       * (the chip is badged, so the pick is informed). The gated size is never
       * rendered — the pipeline pre-pivots — so this signal is the only record
       * of the insistence. */
      readonly type: "gated-size-selected";
      readonly "product-id": string;
      readonly size: string;
      readonly gate: "too_small" | "too_large";
    };

/**
 * Host-dispatched partial signals — events the machine doesn't see (entrypoint
 * mounting, view dismissal, cart/checkout integrations). The bridge's
 * `trackHostEvent` accepts these, enriches with `current-step` where the event
 * spec requires it, and forwards to `tracking.trackEvent`.
 */
export type HostAnalyticsSignal =
  | {
      readonly type: "entrypoint-impression";
      readonly "product-id": string;
      readonly entry: string;
    }
  | {
      readonly type: "entrypoint-clicked";
      readonly "product-id": string;
      readonly entry: string;
      /** Optional finer-grained classifier within `entry`; passed through to the wire. */
      readonly subentry?: string;
    }
  | {
      readonly type: "intro-opened";
      readonly "product-id": string;
      /** `entry` when the sheet opens on the intro screen via an entrypoint (first open only). */
      readonly source: Step;
    }
  | {
      readonly type: "cart-item-added";
      readonly "product-id": string;
      /** Selected variant axes; flattened to `variant-<axis>` wire keys. */
      readonly variants: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "order-placed";
      readonly "product-id": string;
      /** Selected variant axes; flattened to `variant-<axis>` wire keys. */
      readonly variants: Readonly<Record<string, string>>;
    }
  | { readonly type: "view-closed"; readonly "product-id": string };
