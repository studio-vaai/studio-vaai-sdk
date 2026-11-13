import "./core.tsp";
import "./diagnostics.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace StudioVaai {
  // Size recommendations and try-on results

  @error
  @doc("Some request fields are missing, invalid, or conflicting.")
  model TryOnBadRequestProblem extends ProblemDetails {
    kind:
      | CommonBadRequestProblemKind
      | BodyIdBadRequestProblemKind
      | ProductIdBadRequestProblemKind
      | "invalid-try-on-id"
      | "invalid-variant-id";
  }

  @error
  @doc("The body, product, variant, or try-on is not available in the current session or shop. Resources outside that scope are also reported as not found.")
  model TryOnNotFoundProblem extends ProblemDetails {
    kind:
      | BodyNotFoundProblemKind
      | ProductNotFoundProblemKind
      | "variant-not-found"
      | "try-on-not-found";
  }

  @error
  @doc("A size recommendation could not be calculated for this product and body.")
  model SizeRecommendationUnavailableProblem extends ProblemDetails {
    kind: "recommendation-unavailable";
  }

  @doc("Some request fields are missing, invalid, or conflicting.")
  model TryOnBadRequestResponse
    is NoStoreProblemResponse<400, TryOnBadRequestProblem>;

  @doc("The requested body, product, variant, or try-on was not found.")
  model TryOnNotFoundResponse
    is NoStoreProblemResponse<404, TryOnNotFoundProblem>;

  @doc("No size recommendation is available for this product and body.")
  model SizeRecommendationUnavailableResponse
    is NoStoreProblemResponse<400, SizeRecommendationUnavailableProblem>;

  @doc("The requested garment size was rejected. Use reason to choose a localized message; title and detail provide fallback text.")
  model TryOnSizeRejectedResponse
    is NoStoreProblemResponse<422, TryOnGarmentTooSmall | TryOnGarmentTooLarge>;

  @doc("Fit assessment for one size-chart measurement, including garment and shopper measurements and the resulting fit category.")
  model FitCheck {
    @doc("Size-chart measurement identifier, such as `chest_width`.")
    pointId: string;

    @doc("The brand-authored column label (e.g. `\"Chest Width\"`).")
    label: string;

    @doc("Body measurement identifier for display and icon mapping: `chest` | `waist` | `hip` | `bottom` | `total_length` | `sleeve_length` | `shoulder_width` | `inseam` | `other`.")
    dimension: string;

    @doc("Garment circumference for this size, in millimetres.")
    garmentMm: float64;

    @doc("Matching shopper body circumference, in millimetres.")
    bodyMm: float64;

    @doc("Garment circumference minus body circumference, in millimetres. Negative values indicate that the garment is smaller than the body.")
    easeMm: float64;

    @doc("Distance from the intended fit, normalized by the fit tolerance. `0` is the intended fit; `-1` and `1` mark the boundaries of the intended range.")
    easeNorm: float64;

    @doc("Offset of the intended-fit range on the fit scale, in the same units as `easeNorm`. Positive values indicate a looser or longer intended fit.")
    idealShiftNorm: float64;

    @doc("Uncertainty of the intended-fit estimate, in the same units as `easeNorm`. Larger values indicate greater uncertainty.")
    intentSigmaNorm: float64;

    @doc("Fit category: `too_small` | `runs_tight` | `ideal` | `runs_loose` | `too_loose`.")
    fit: string;

    @doc("English explanation of this measurement. Use `fit` to provide your own localized text.")
    sentence: string;
  }

  @doc("One ranked size suggestion from the brand size chart, best first.")
  model SizeRecommendation {
    @doc("This size on every axis it is sold by, in your shop's own ids (for example `{ size: \"M\" }`, or `{ size: \"32\", style: \"32\" }` for waist × length). Colorway is not part of a size.")
    foreignIds: Record<string>;

    @doc("1-based rank; `1` is the best fit.")
    rank: int32;

    @doc("Human-readable rationale, e.g. `\"Chest fits with +32 cm ease — oversized as intended\"`.")
    rationale: string;

    @doc("Fit category for this size: `too_small` | `runs_tight` | `ideal` | `runs_loose` | `too_loose`.")
    fit: string;

    @doc("Fit-match score from 0 to 100. Higher values indicate a closer match to the product's intended fit.")
    fitMatch: int32;

    @doc("Fit assessments for the available circumference measurements, in size-chart order.")
    fitChecks: FitCheck[];

    @doc("Present when a try-on in this size would be rejected as `too_small` or `too_large`. Use this to mark unavailable try-on sizes before submitting a request.")
    gate?: "too_small" | "too_large";
  }

  @doc("Size recommendations for a body and product. Includes the best available size and a ranked breakdown of all size-chart entries.")
  model RecommendedSize {
    @doc("The body revision used to compute this recommendation.")
    bodyRevisionId?: string;
    @doc("Best available size for the shopper, in your shop's own ids. Absent when no size is eligible for try-on; show a no-suitable-size state instead of selecting a size automatically.")
    recommendedForeignIds?: Record<string>;

    @doc("The size-chart entries your shop sells, ranked best first. Empty when no size chart is available. For products with multiple variant axes, each entry describes one published combination.")
    recommendations: SizeRecommendation[];
  }

  @doc("The variant to try on.")
  model CreateTryOnBody {
    @doc("Pin the exact body revision to render. Omit to use the current revision.")
    bodyRevisionId?: string;

    @doc("`id` of one of the product's `ProductDetails.variants`. An unknown id returns `variant-not-found`.")
    variantId: string;
  }

  @doc("Presentation settings for the try-on image.")
  model TryOnScene {
    @doc("Lowercase `#RRGGBB` hex.")
    overlayColor: string;
  }

  @doc("Position of a fit annotation in the try-on image. Coordinates range from 0 to 1 relative to the complete image, with x increasing rightwards and y increasing downwards.")
  model FitAnchor {
    @doc("Body-dimension slug matching `FitCheck.dimension`: `chest` | `waist` | `sleeve_length` | `total_length`.")
    dimension: string;

    @doc("Side of a paired annotation (`left` or `right`). Omitted for central annotations. Choose the better-positioned side when both are available.")
    side?: string;

    @doc("Normalized x in the output image (0 = left edge, 1 = right edge).")
    x: float64;

    @doc("Normalized y in the output image (0 = top edge, 1 = bottom edge).")
    y: float64;
  }

  model TryOnSuccess {
    @doc("The body revision rendered by this request, returned when creating a try-on.")
    bodyRevisionId?: string;
    tryOnId: string;
    status: "completed";

    @doc("The variant that was tried on. Absent when that variant has since been retired.")
    variantId?: string;

    imageUrl: string;
    scene: TryOnScene;

    @doc("Optional positions for fit annotations in the try-on image. Omitted when no annotations are available.")
    fitAnchors?: FitAnchor[];

    @doc("Diagnostic metadata for internal tooling.")
    @extension("x-internal", true)
    provenance?: TryOnProvenance;
  }

  @error
  @doc("The requested garment size was rejected for this body. Choose another size using the supplied reason and suggested alternative.")
  model TryOnSizeRejectionProblem extends ProblemDetails {
    kind: "try-on-size-rejected";

    @doc("Identifier of the rejected try-on.")
    tryOnId: string;

    @doc("The variant that was requested. Absent when that variant has since been retired.")
    variantId?: string;

    @doc("Alternative size to try, in your shop's own ids: one your shop sells. Colorway is not part of a size. Absent when your shop sells no size in that direction.")
    recommendedForeignIds?: Record<string>;
  }

  @error
  @doc("The selected size is too small for this body. Choose another size.")
  model TryOnGarmentTooSmall extends TryOnSizeRejectionProblem {
    @doc("The garment is too small. Use this code to choose a localized message.")
    reason: "garment_too_small";
  }

  @error
  @doc("The selected size is too large for this body. Choose another size.")
  model TryOnGarmentTooLarge extends TryOnSizeRejectionProblem {
    @doc("The garment is too large. Use this code to choose a localized message.")
    reason: "garment_too_large";
  }

  @doc("Get size recommendations, create try-ons, and retrieve their results. All operations require a client API key and a session. Every success and error response includes Cache-Control: no-store. Errors use application/problem+json.")
  @tag("try-on")
  interface TryOn {
    @get
    @route("/products/{productId}/recommended-size")
    @operationId("getRecommendedSize")
    @summary("Get size recommendations")
    @doc("Get ranked size recommendations for a product and a body whose height has been set. If no size is eligible for try-on, `recommendedForeignIds` is absent; the ranked breakdown remains available.")
    getRecommendedSize(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @path productId: string,

      @doc("Body to use for the recommendation. Must belong to the current session.")
      @query
      bodyId: string,
      @doc("Pin the exact body revision to score. Omit to use the current revision.")
      @query
      bodyRevisionId?: string,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body result: RecommendedSize;
        }
      | TryOnBadRequestResponse
      | SizeRecommendationUnavailableResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | TryOnNotFoundResponse
      | NoStoreInternalServerErrorResponse;

    @post
    @route("/products/{productId}/try-on")
    @operationId("createTryOn")
    @summary("Generate a try-on")
    @doc("Generate a try-on for a body and a published product variant. This request waits for completion. Success returns 201 with the image. A size rejection returns a 422 problem response with a reason and a suggested alternative size. Use `getProductDetails` to discover the product's variants.")
    createTryOn(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @path productId: string,

      @doc("Body to use for the try-on. Must belong to the current session.")
      @query
      bodyId: string,

      @doc("Optional diagnostic fields for internal tooling.")
      @extension("x-internal", true)
      @query
      include?: string,

      @body body: CreateTryOnBody,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 201;
          @body result: TryOnSuccess;
        }
      | TryOnBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | TryOnNotFoundResponse
      | TryOnSizeRejectedResponse
      | NoStoreInternalServerErrorResponse;

    @get
    @route("/try-ons/{tryOnId}")
    @operationId("getTryOn")
    @summary("Get a try-on")
    @doc("Retrieve a try-on result from the current session. An image returns 200. A stored size rejection returns the same 422 problem response as creation. A missing or inaccessible try-on returns 404.")
    getTryOn(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @path tryOnId: string,

      @doc("Optional diagnostic fields for internal tooling.")
      @extension("x-internal", true)
      @query
      include?: string,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body result: TryOnSuccess;
        }
      | TryOnBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | TryOnNotFoundResponse
      | TryOnSizeRejectedResponse
      | NoStoreInternalServerErrorResponse;
  }
}
