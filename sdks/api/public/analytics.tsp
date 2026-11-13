import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "studio vaai Analytics API" })
@OpenAPI.info(#{
  version: "2026-11-04",
  summary: "Collect storefront and try-on events.",
})
@server("https://a.studio-vaai.com", "Analytics")
@useAuth(NoAuth)
namespace StudioVaaiAnalytics {
  /** A step in the user flow. */
  union AnalyticsStep {
    "entry",
    "intro",
    "image-record",
    "image-upload",
    "image-rejection",
    "height",
    "variant-selection",
    "try-on",
  }

  /** Where the user starts selecting or taking a photo. */
  union AnalyticsImageSource {
    "intro",
    "variant-selection",
    "image-rejection",
    "height",
  }

  model AnalyticsContext {
    @doc("Storefront hostname, without a scheme or path.")
    @maxLength(100)
    @example("shop.example.com")
    hostname?: string;

    @doc("Page path or URL. Prefer a path without sensitive query parameters.")
    @example("/products/longsleeve")
    url?: string;

    @doc("Optional anonymous visitor identifier. Reuse the experiment assignment visitor ID to correlate rollout and conversion events. Never send a shopper session token or personal identifier.")
    id?: string;

    @doc("Browser language, for example en-GB.")
    @maxLength(35)
    language?: string;

    @doc("Screen dimensions, for example 390x844.")
    @maxLength(11)
    screen?: string;

    @doc("Page title.")
    title?: string;

    @doc("Referring page path or URL.")
    referrer?: string;
  }

  model AnalyticsProductData {
    @doc("Product associated with this event.")
    @example("longsleeve")
    `product-id`: string;

    @doc("SDK package and version, when using an SDK. Custom integrations may omit this property.")
    `sdk-version`?: string;
  }

  /** Additional variant-<axis> string properties describe the selected variant, for example variant-colorway or variant-length. */
  model AnalyticsVariantData extends Record<string> {
    ...AnalyticsProductData;

    @doc("Selected size, if the product has a size axis.")
    `variant-size`?: string;

    @doc("Selected colorway, if the product has a colorway axis.")
    `variant-colorway`?: string;
  }

  /** A try-on button or link becomes visible. */
  @extension("x-event-group", "Entry & consent")
  model EntrypointImpression {
    ...AnalyticsContext;
    name: "entrypoint-impression";
    data: {
      ...AnalyticsProductData;

      @doc("Merchant-defined entrypoint placement, for example pdp-button.")
      entry: string;
    };
  }
  /** The shopper clicks a try-on entrypoint to open or resume the flow. */
  @extension("x-event-group", "Entry & consent")
  model EntrypointClicked {
    ...AnalyticsContext;
    name: "entrypoint-clicked";
    data: {
      ...AnalyticsProductData;
      @doc("Merchant-defined entrypoint placement.") entry: string;
      @doc("Optional finer-grained placement.") subentry?: string;
      `current-step`: AnalyticsStep;
    };
  }
  /** The introduction opens. Use entry as the source on first open. */
  @extension("x-event-group", "Entry & consent")
  model IntroOpened {
    ...AnalyticsContext;
    name: "intro-opened";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsStep;
    };
  }
  /** The shopper consents to processing their photo and body measurements. Create the session separately. */
  @extension("x-event-group", "Entry & consent")
  model ConsentGranted {
    ...AnalyticsContext;
    name: "consent-granted";
    data: AnalyticsProductData;
  }
  /** The shopper enters the camera flow. */
  @extension("x-event-group", "Photo & height")
  model ImageRecordInitiated {
    ...AnalyticsContext;
    name: "image-record-initiated";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsImageSource;
    };
  }
  /** The shopper leaves the camera without submitting a photo. */
  @extension("x-event-group", "Photo & height")
  model ImageRecordAborted {
    ...AnalyticsContext;
    name: "image-record-aborted";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsImageSource;
    };
  }
  /** The photo picker opens. */
  @extension("x-event-group", "Photo & height")
  model ImageUploadInitiated {
    ...AnalyticsContext;
    name: "image-upload-initiated";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsImageSource;
    };
  }
  /** The photo picker closes without a selection. */
  @extension("x-event-group", "Photo & height")
  model ImageUploadAborted {
    ...AnalyticsContext;
    name: "image-upload-aborted";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsImageSource;
    };
  }
  /** Photo processing completes; the photo is ready for height confirmation. */
  @extension("x-event-group", "Photo & height")
  model ImageUploaded {
    ...AnalyticsContext;
    name: "image-uploaded";
    data: {
      ...AnalyticsProductData;
      `image-source`: "record-self-timer" | "record-system-dialog" | "select";
    };
  }
  /** The shopper confirms or updates their height. */
  @extension("x-event-group", "Photo & height")
  model HeightEntered {
    ...AnalyticsContext;
    name: "height-entered";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsStep;
    };
  }
  /** Size and colour selection opens. */
  @extension("x-event-group", "Selection & try-on")
  model VariantSelectionInitiated {
    ...AnalyticsContext;
    name: "variant-selection-initiated";
    data: {
      ...AnalyticsProductData;
      source: AnalyticsStep;
      via?: "back" | "go-to-product-overview";
    };
  }
  /** A try-on starts for the selected variant. */
  @extension("x-event-group", "Selection & try-on")
  model TryOnInitiated {
    ...AnalyticsContext;
    name: "try-on-initiated";
    data: AnalyticsVariantData;
  }
  /** The shopper selects a size marked too small or too large. */
  @extension("x-event-group", "Selection & try-on")
  model GatedSizeSelected {
    ...AnalyticsContext;
    name: "gated-size-selected";
    data: {
      ...AnalyticsProductData;
      `variant-size`: string;
      gate: "too_small" | "too_large";
    };
  }
  /** A product variant is successfully added to the cart. */
  @extension("x-event-group", "Cart & orders")
  model CartItemAdded {
    ...AnalyticsContext;
    name: "cart-item-added";
    data: AnalyticsVariantData;
  }
  /** A purchase completes. Send once per product variant. */
  @extension("x-event-group", "Cart & orders")
  model OrderPlaced {
    ...AnalyticsContext;
    name: "order-placed";
    data: AnalyticsVariantData;
  }
  /** The try-on view closes; include the current step. */
  @extension("x-event-group", "Selection & try-on")
  model ViewClosed {
    ...AnalyticsContext;
    name: "view-closed";
    data: {
      ...AnalyticsProductData;
      `current-step`: AnalyticsStep;
    };
  }
  /** A visitor receives a rollout assignment. Send once per assignment using the same anonymous visitor ID. */
  @extension("x-event-group", "Rollout")
  model ExperimentAssigned {
    ...AnalyticsContext;
    name: "experiment-assigned";
    data: {
      experiment: "try-on-enabled";
      variant: "enabled" | "disabled";

      @doc("SDK package and version, when applicable.")
      `sdk-version`?: string;
    };
  }

  /** A try-on operation failed or its outcome could not be confirmed. */
  @extension("x-event-group", "Try-on")
  model ExperienceOperationFailed {
    ...AnalyticsContext;
    name: "experience-operation-failed";
    data: {
      ...AnalyticsProductData;
      work: string;
      outcome: string;
      reason?: string;
      `current-step`: AnalyticsStep;
    };
  }

  /** Named events supported by studio vaai integrations. Data values are flat string, number, or boolean properties; the event definitions specify the supported properties. */
  union AnalyticsEvent {
    EntrypointImpression,
    EntrypointClicked,
    IntroOpened,
    ConsentGranted,
    ImageRecordInitiated,
    ImageRecordAborted,
    ImageUploadInitiated,
    ImageUploadAborted,
    ImageUploaded,
    HeightEntered,
    VariantSelectionInitiated,
    TryOnInitiated,
    GatedSizeSelected,
    CartItemAdded,
    OrderPlaced,
    ViewClosed,
    ExperimentAssigned,
    ExperienceOperationFailed,
  }

  @example(#{
    type: "event",
    payload: #{
      hostname: "shop.example.com",
      url: "/products/longsleeve",
      name: "try-on-initiated",
      data: #{ `product-id`: "longsleeve", `variant-size`: "M" },
    },
  })
  model AnalyticsEventRequest {
    type: "event";
    payload: AnalyticsEvent;
  }

  @tag("analytics")
  interface Analytics {
    @post
    @route("/api/send")
    @operationId("sendAnalyticsEvent")
    @summary("Send an analytics event")
    @doc("""
      Send storefront and try-on events with the same X-Client-Api-Key used by the business API. The API key identifies the shop. Omit shopper credentials and cookies.

      See [Analytics](/api/analytics) for integration guidance and the event catalogue.
      """)
    sendAnalyticsEvent(
      @header("X-Client-Api-Key") clientApiKey: string,
      @body body: AnalyticsEventRequest,
    ):
      | {
          @statusCode _: 204;
        }
      | {
          @statusCode _: 400 | 401 | 403 | 413 | 502 | 503;
        };
  }
}
