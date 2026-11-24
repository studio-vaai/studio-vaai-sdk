import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "studio vaai Analytics API" })
@OpenAPI.info(#{
  version: "2026-11-20",
  summary: "Collect cookieless storefront and try-on event counts.",
})
@server("https://a.studio-vaai.com", "Analytics")
@useAuth(NoAuth)
namespace StudioVaaiAnalytics {
  union AnalyticsStep {
    "entry", "intro", "image-record", "image-upload", "image-rejection",
    "height", "variant-selection", "try-on",
  }

  union AnalyticsImageSource { "intro", "variant-selection", "image-rejection", "height" }

  @minLength(1) @maxLength(64) @pattern("^[A-Za-z0-9][A-Za-z0-9_.:-]*$") scalar CatalogKey extends string;
  @minLength(1) @maxLength(64) @pattern("^[A-Za-z0-9][A-Za-z0-9_.:-]*$") scalar AnalyticsLabel extends string;
  @minValue(0) @maxValue(32) scalar CappedCount extends int32;

  model AnalyticsProductData {
    /** Catalog product associated with this event. */
    `product-id`: CatalogKey;
  }

  model AnalyticsVariantData {
    ...AnalyticsProductData;
    /** Canonical variant ID, where supplied by the SDK. */
    `variant-id`?: CatalogKey;
    /** Catalog size, colorway, waist or length supplied by an existing host callback. */
    `variant-size`?: CatalogKey;
    `variant-colorway`?: CatalogKey;
    `variant-waist`?: CatalogKey;
    `variant-length`?: CatalogKey;
  }

  /** A try-on entry point becomes visible. */
  @extension("x-event-group", "Storefront")
  model EntrypointImpression {
    name: "entrypoint-impression";
    data: { ...AnalyticsProductData; entry: AnalyticsLabel; };
  }

  /** A try-on entry point activates. */
  @extension("x-event-group", "Storefront")
  model EntrypointClicked {
    name: "entrypoint-clicked";
    data: { ...AnalyticsProductData; entry: AnalyticsLabel; };
  }

  /** A widget opens or resumes. */
  @extension("x-event-group", "Storefront")
  model WidgetOpened {
    name: "widget-opened";
    data: { ...AnalyticsProductData; entry?: AnalyticsLabel; };
  }

  /** The introduction opens. */
  @extension("x-event-group", "Setup")
  model IntroOpened {
    name: "intro-opened";
    data: { ...AnalyticsProductData; source: AnalyticsStep; };
  }

  /** The widget acknowledges the photo and body processing consent action. */
  @extension("x-event-group", "Setup")
  model ConsentGranted {
    name: "consent-granted";
    data: AnalyticsProductData;
  }

  /** The shopper launches the camera flow. */
  @extension("x-event-group", "Setup")
  model ImageRecordInitiated {
    name: "image-record-initiated";
    data: { ...AnalyticsProductData; source: AnalyticsImageSource; };
  }

  /** The shopper cancels the camera flow. */
  @extension("x-event-group", "Setup")
  model ImageRecordAborted {
    name: "image-record-aborted";
    data: { ...AnalyticsProductData; source: AnalyticsImageSource; };
  }

  /** The shopper launches the photo picker. */
  @extension("x-event-group", "Setup")
  model ImageUploadInitiated {
    name: "image-upload-initiated";
    data: { ...AnalyticsProductData; source: AnalyticsImageSource; };
  }

  /** The shopper cancels the photo picker. */
  @extension("x-event-group", "Setup")
  model ImageUploadAborted {
    name: "image-upload-aborted";
    data: { ...AnalyticsProductData; source: AnalyticsImageSource; };
  }

  /** Photo processing succeeds. */
  @extension("x-event-group", "Setup")
  model ImageUploaded {
    name: "image-uploaded";
    data: { ...AnalyticsProductData; `image-source`: "record-self-timer" | "record-system-dialog" | "select"; };
  }

  /** Photo processing rejects the photo. */
  @extension("x-event-group", "Setup")
  model PhotoRejected {
    name: "photo-rejected";
    data: { ...AnalyticsProductData; method: "camera" | "picker"; };
  }

  /** The widget acknowledges a height confirmation. */
  @extension("x-event-group", "Setup")
  model HeightEntered {
    name: "height-entered";
    data: AnalyticsProductData;
  }

  /** The widget opens the height step. */
  @extension("x-event-group", "Setup")
  model HeightStepOpened {
    name: "height-step-opened";
    data: { ...AnalyticsProductData; source: AnalyticsStep; };
  }

  /** The variant selection screen opens. */
  @extension("x-event-group", "Try-on")
  model VariantSelectionInitiated {
    name: "variant-selection-initiated";
    data: { ...AnalyticsProductData; source: AnalyticsStep; via?: "back" | "go-to-product-overview"; };
  }

  /** The selection changes to a different variant. */
  @extension("x-event-group", "Try-on")
  model VariantChanged {
    name: "variant-changed";
    data: AnalyticsVariantData;
  }

  /** The widget requests a try-on. */
  @extension("x-event-group", "Try-on")
  model TryOnInitiated {
    name: "try-on-initiated";
    data: { ...AnalyticsVariantData; origin?: "shopper" | "automatic"; };
  }

  /** The shopper selects a fit-gated size. */
  @extension("x-event-group", "Try-on")
  model GatedSizeSelected {
    name: "gated-size-selected";
    data: AnalyticsProductData;
  }

  /** A distinct try-on result is shown in the widget. */
  @extension("x-event-group", "Try-on")
  model TryOnPresented {
    name: "try-on-presented";
    data: AnalyticsVariantData;
  }

  /** An open widget closes. */
  @extension("x-event-group", "Try-on")
  model ViewClosed {
    name: "view-closed";
    data: { ...AnalyticsProductData; `current-step`: AnalyticsStep; `result-displayed`?: boolean; };
  }

  /** An operation fails, detaches or has an unknown outcome. Slow and deadline signals can be counted independently. */
  @extension("x-event-group", "Try-on")
  model ExperienceOperationFailed {
    name: "experience-operation-failed";
    data: { ...AnalyticsProductData; work: "session" | "height" | "camera" | "capture" | "picker" | "photo" | "try-on"; outcome: "failed" | "uncertain" | "detached" | "in_progress"; reason?: "deadline" | "slow"; `current-step`: AnalyticsStep; };
  }

  /** A bounded summary for one observed open and product. */
  @extension("x-event-group", "Try-on")
  model ExperienceSummary {
    name: "experience-summary";
    data: {
      ...AnalyticsProductData;
      entry?: AnalyticsLabel;
      `reached-intro`: boolean;
      `granted-consent`: boolean;
      `accepted-photo`: boolean;
      `confirmed-height`: boolean;
      `reached-selection`: boolean;
      `requested-try-on`: boolean;
      `presented-result`: boolean;
      `requested-cart`: boolean;
      `try-on-count`: CappedCount;
      `distinct-sizes`?: CappedCount;
      `distinct-colors`?: CappedCount;
      `distinct-waists`?: CappedCount;
      `distinct-lengths`?: CappedCount;
      `time-to-result`?: "lt-10s" | "10-29s" | "30-59s" | "60-119s" | "120s-plus";
    };
  }

  /** One distinct recommended and presented size pair in an open product experience, or a confirmed cart addition. Axis values are shop catalog identifiers. Omitted axes remain unobserved. */
  @extension("x-event-group", "Try-on")
  model SizeCompared {
    name: "size-compared";
    data: {
      ...AnalyticsProductData;
      measure: "tried" | "cart";
      `recommended-size`?: CatalogKey;
      `observed-size`?: CatalogKey;
      `recommended-length`?: CatalogKey;
      `observed-length`?: CatalogKey;
    };
  }

  /** The widget hands a cart request to the host. */
  @extension("x-event-group", "Commerce")
  model CartRequested {
    name: "cart-requested";
    data: AnalyticsVariantData;
  }

  /** The host reports a successful cart addition. */
  @extension("x-event-group", "Commerce")
  model CartItemAdded {
    name: "cart-item-added";
    data: AnalyticsVariantData;
  }

  /** The host reports one purchased variant. */
  @extension("x-event-group", "Commerce")
  model OrderPlaced {
    name: "order-placed";
    data: AnalyticsVariantData;
  }

  /** An eligible rollout decision is observed. */
  @extension("x-event-group", "Rollout")
  model ExperimentAssigned {
    name: "experiment-assigned";
    data: { experiment: "try-on-enabled"; variant: "enabled" | "disabled"; };
  }

  /** An event occurrence, with only its declared data fields. */
  union AnalyticsEvent {
    EntrypointImpression, EntrypointClicked, WidgetOpened, IntroOpened, ConsentGranted,
    ImageRecordInitiated, ImageRecordAborted, ImageUploadInitiated, ImageUploadAborted,
    ImageUploaded, PhotoRejected, HeightEntered, HeightStepOpened, VariantSelectionInitiated,
    VariantChanged, TryOnInitiated, GatedSizeSelected, TryOnPresented, ViewClosed,
    ExperienceOperationFailed, ExperienceSummary, SizeCompared, CartRequested, CartItemAdded, OrderPlaced,
    ExperimentAssigned,
  }

  model AnalyticsEventRequest {
    /** UUID v4 generated for this occurrence only. Reuse only when repeating the same request. */
    @format("uuid")
    eventId: string;
    event: AnalyticsEvent;
  }

  @error
  model AnalyticsEventProblem {
    title: string;
    kind:
        | "invalid-event"
        | "invalid-client-key"
        | "origin-forbidden"
        | "event-id-conflict"
        | "event-too-large"
        | "unsupported-media-type"
        | "upstream-delivery-failed"
        | "collector-unavailable";
  }

  model AnalyticsEventError {
    @statusCode status: 400 | 401 | 403 | 409 | 413 | 415 | 502 | 503;
    @header contentType: "application/problem+json";
    @body body: AnalyticsEventProblem;
  }

  @tag("analytics")
  interface Analytics {
    @post
    @route("/v2/events")
    @operationId("sendAnalyticsEvent")
    @summary("Send an analytics event")
    @doc("""
      Send storefront and try-on events with the same X-Client-Api-Key used by the business API.
      Omit shopper credentials, cookies and browser context. An event ID identifies one occurrence.

      See [Analytics](/analytics) for integration guidance and the event catalogue.
      """)
    sendAnalyticsEvent(
      @header("X-Client-Api-Key") clientApiKey: string,
      @body body: AnalyticsEventRequest,
    ): { @statusCode _: 204; } | AnalyticsEventError;
  }
}
