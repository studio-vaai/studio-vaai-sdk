import type { ImageFlowSource } from "./image-flow-source.js";
import type { Step } from "./steps.js";

/**
 * Shape every tracked event must satisfy. The `name` field is the
 * discriminator Umami uses for the event name; `data` becomes Umami's event
 * `data` payload — each variant declares its own concrete data shape so call
 * sites get field-level autocomplete.
 *
 * Wire convention: event names and `data` keys are kebab-case so they read
 * cleanly in Umami's event-data viewer. Values must be string/number/boolean
 * primitives — the transport doesn't recursively serialize nested objects.
 */
export interface TrackingEventBase {
  /** Stable event name (kebab-case). Becomes the Umami event name. */
  readonly name: string;
  /** Flat primitive payload. Each variant tightens this to a concrete shape. */
  readonly data?: object;
}

/**
 * Fields present on every event's `data`. The transport additionally injects
 * `sdk-version` from {@link FetchTrackingClientConfig.sdkVersion}, so
 * callers never set that themselves.
 */
interface CommonData {
  readonly "product-id": string;
}

interface EntrypointImpressionEvent extends TrackingEventBase {
  readonly name: "entrypoint-impression";
  readonly data: CommonData & {
    /** Merchant-defined identifier for the entrypoint placement. */
    readonly entry: string;
  };
}

interface EntrypointClickedEvent extends TrackingEventBase {
  readonly name: "entrypoint-clicked";
  readonly data: CommonData & {
    readonly entry: string;
    /**
     * Optional finer-grained placement classifier within `entry` (e.g.
     * `entry: "pdp-button"` + `subentry: "size-row"`). Merchant-defined.
     */
    readonly subentry?: string;
    readonly "current-step": Step;
  };
}

interface IntroOpenedEvent extends TrackingEventBase {
  readonly name: "intro-opened";
  readonly data: CommonData & {
    /** `entry` when opened via entrypoint on the user's first sheet open; machine re-entries use the prior step. */
    readonly source: Step;
  };
}

interface ConsentGrantedEvent extends TrackingEventBase {
  readonly name: "consent-granted";
  readonly data: CommonData;
}

interface ImageRecordInitiatedEvent extends TrackingEventBase {
  readonly name: "image-record-initiated";
  readonly data: CommonData & {
    readonly source: ImageFlowSource;
  };
}

interface ImageRecordAbortedEvent extends TrackingEventBase {
  readonly name: "image-record-aborted";
  readonly data: CommonData & {
    readonly source: ImageFlowSource;
  };
}

interface ImageUploadInitiatedEvent extends TrackingEventBase {
  readonly name: "image-upload-initiated";
  readonly data: CommonData & {
    readonly source: ImageFlowSource;
  };
}

interface ImageUploadAbortedEvent extends TrackingEventBase {
  readonly name: "image-upload-aborted";
  readonly data: CommonData & {
    readonly source: ImageFlowSource;
  };
}

interface ImageUploadedEvent extends TrackingEventBase {
  readonly name: "image-uploaded";
  readonly data: CommonData & {
    readonly "image-source": "record-self-timer" | "record-system-dialog" | "select";
  };
}

interface HeightEnteredEvent extends TrackingEventBase {
  readonly name: "height-entered";
  readonly data: CommonData & {
    /** Typically `image-upload` | `variant-selection`. */
    readonly source: Step;
  };
}

/** How the user returned to variant selection from the try-on result screen. */
export type VariantSelectionVia = "back" | "go-to-product-overview";

interface VariantSelectionInitiatedEvent extends TrackingEventBase {
  readonly name: "variant-selection-initiated";
  readonly data: CommonData & {
    /** Typically `height` | `try-on`. */
    readonly source: Step;
    /**
     * Present when re-entering variant selection from the try-on result screen.
     * `back` = header back; `go-to-product-overview` = secondary CTA
     * (`tryOnView.goToProductOverview`).
     */
    readonly via?: VariantSelectionVia;
  };
}

/**
 * Selected variant axes carried by events that fire after the user has chosen
 * a specific variant (try-on, cart add, order). Emitted as flat
 * `variant-<axis>` keys (e.g. `variant-colorway`, `variant-size`,
 * `variant-length`). Axis names are open so merchants can configure new axes
 * without an SDK change.
 */
type VariantData = Readonly<Partial<Record<`variant-${string}`, string>>>;

interface TryOnInitiatedEvent extends TrackingEventBase {
  readonly name: "try-on-initiated";
  readonly data: CommonData & VariantData;
}

/**
 * Fires when the shopper deliberately selects a size the fit gate marks as
 * unwearable for their body (the chip carries a "too small"/"too big" badge, so
 * the pick is informed). The gated size is never rendered — the flow pre-pivots
 * the try-on to the recommended size — so this event is the only signal of the
 * shopper's insistence, and its rate per product is direct feedback on how much
 * shoppers trust or contest the gate's verdicts.
 */
interface GatedSizeSelectedEvent extends TrackingEventBase {
  readonly name: "gated-size-selected";
  readonly data: CommonData & {
    /** The gated size slug the shopper picked. */
    readonly "variant-size": string;
    /** The gate's verdict for that size. */
    readonly gate: "too_small" | "too_large";
  };
}

interface CartItemAddedEvent extends TrackingEventBase {
  readonly name: "cart-item-added";
  readonly data: CommonData & VariantData;
}

interface OrderPlacedEvent extends TrackingEventBase {
  readonly name: "order-placed";
  readonly data: CommonData & VariantData;
}

interface ViewClosedEvent extends TrackingEventBase {
  readonly name: "view-closed";
  readonly data: CommonData & {
    readonly "current-step": Step;
  };
}

/**
 * Fires once when the backend assigns a visitor to an arm of the try-on
 * rollout A/B test. Feature-level (no `product-id`) — it gates the entry point
 * before any product context exists. Correlate `variant` against downstream
 * conversion events in Umami to measure the test.
 */
interface ExperimentAssignedEvent extends TrackingEventBase {
  readonly name: "experiment-assigned";
  readonly data: {
    /** Experiment identifier; currently always `try-on-enabled`. */
    readonly experiment: "try-on-enabled";
    /** Assigned arm. */
    readonly variant: "enabled" | "disabled";
  };
}

/**
 * Discriminated union of every event the SDK can send. Add new events by
 * declaring a variant interface above and appending it to the union — call
 * sites get full autocomplete + type-checking on `name` and `data`.
 */
export type TrackingEvent =
  | EntrypointImpressionEvent
  | EntrypointClickedEvent
  | IntroOpenedEvent
  | ConsentGrantedEvent
  | ImageRecordInitiatedEvent
  | ImageRecordAbortedEvent
  | ImageUploadInitiatedEvent
  | ImageUploadAbortedEvent
  | ImageUploadedEvent
  | HeightEnteredEvent
  | VariantSelectionInitiatedEvent
  | TryOnInitiatedEvent
  | GatedSizeSelectedEvent
  | CartItemAddedEvent
  | OrderPlacedEvent
  | ViewClosedEvent
  | ExperimentAssignedEvent;
