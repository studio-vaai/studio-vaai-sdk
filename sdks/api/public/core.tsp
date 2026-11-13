import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

/** The server chooses the shop-scoped cookie name from X-Client-Api-Key. */
model SessionCookieAuth
  is ApiKeyAuth<ApiKeyLocation.cookie, "__Host-vaai_session_{shopId}">;

@service(#{ title: "studio vaai Public API" })
@OpenAPI.info(#{
  version: "2026-11-05",
  summary: "Integrate virtual try-on into your storefront.",
})
@server("https://api.studio-vaai.com", "Live")
@doc("Create shopper sessions, upload photos, retrieve size recommendations, and generate virtual try-ons. Business API requests use your shop's `X-Client-Api-Key`; OFREP evaluations use `X-API-Key`. Shopper-specific operations also require a Bearer session token or session cookie.")
@useAuth(BearerAuth | SessionCookieAuth)
namespace StudioVaai {
  /** Error body for failed requests (`application/problem+json`). */
  @error
  model ProblemDetails {
    /** A URI reference (or token) that identifies the problem kind. */
    kind: string;

    /** A short, human-readable summary of the problem type. */
    title: string;

    /** A human-readable explanation specific to this occurrence. */
    detail?: string;
  }

  // Request validation, shop identification, Origin, and credential-selection errors shared across operations.
  alias CommonBadRequestProblemKind =
    | "invalid-request"
    | "client-api-key-required"
    | "client-api-key-header-invalid"
    | "client-api-key-malformed"
    | "origin-header-invalid"
    | "origin-not-a-url"
    | "cookie-origin-required"
    | "ambiguous-session";

  // Shared request errors for operations that accept a shop key but require Authorization to be omitted.
  alias ShopOnlyBadRequestProblemKind =
    | CommonBadRequestProblemKind
    | "invalid-authorization";

  // Upload metadata errors shared by image-upload operations.
  alias UploadBadRequestProblemKind =
    | "invalid-content-type"
    | "invalid-byte-size";

  // Body and product references are shared by body, catalog, and try-on operations.
  alias BodyIdBadRequestProblemKind = "invalid-body-id";
  alias BodyNotFoundProblemKind = "body-not-found";
  alias ProductIdBadRequestProblemKind = "invalid-product-id";
  alias ProductNotFoundProblemKind = "product-not-found";

  // Infrastructure failures shared across operations.
  alias CommonInternalServerErrorProblemKind =
    | "internal-server-error"
    | "client-api-key-validation-failed"
    | "session-lookup-failed";

  @error
  @doc("The service could not complete the request because of an internal failure.")
  model InternalServerErrorProblem extends ProblemDetails {
    kind: CommonInternalServerErrorProblemKind;
  }

  @error
  @doc("The service is temporarily unavailable. Retry later.")
  model ServiceUnavailableProblem extends ProblemDetails {
    kind: "service-unavailable";
  }

  @doc("Prevents caching of availability results, credentials, challenges, signed URLs, and shopper-specific metadata, including errors.")
  model NoStoreResponseHeaders {
    @header("Cache-Control") cacheControl: "no-store";
  }

  model NoStoreProblemResponse<
    Status extends int32,
    Problem extends ProblemDetails
  > extends NoStoreResponseHeaders {
    @statusCode _: Status;
    @header("Content-Type") contentType: "application/problem+json";
    @body problem: Problem;
  }

  @doc("An internal failure prevented the request from being completed.")
  model NoStoreInternalServerErrorResponse
    is NoStoreProblemResponse<500, InternalServerErrorProblem>;

  @doc("The service is temporarily unavailable.")
  model NoStoreServiceUnavailableResponse
    is NoStoreProblemResponse<503, ServiceUnavailableProblem>;

  @error
  @doc("An active session credential accepted by this endpoint is required. Expired or invalid sessions require a new session and consent.")
  model SessionUnauthorizedProblem extends ProblemDetails {
    kind:
      | "session-token-required"
      | "session-token-malformed"
      | "session-invalid"
      | "session-expired"
      | "session-transport-mismatch"
      | "unsupported-auth-scheme";
  }

  @error
  @doc("The shop key is unknown, the Origin is not allowed, or the session belongs to another shop.")
  model SessionForbiddenProblem extends ProblemDetails {
    kind:
      | "client-api-key-unknown"
      | "origin-not-allowed"
      | "session-shop-mismatch";
  }

  @doc("The session credential is missing, malformed, invalid, expired, or used with the wrong transport.")
  model SessionUnauthorizedResponse
    extends NoStoreProblemResponse<401, SessionUnauthorizedProblem> {
    @doc("HTTP authentication challenge for the session credential accepted by this endpoint.")
    @header("WWW-Authenticate")
    wwwAuthenticate: string;
  }

  @doc("The shop, Origin, or session scope does not permit this request.")
  model SessionForbiddenResponse
    is NoStoreProblemResponse<403, SessionForbiddenProblem>;

  /** The request could not be completed. See `kind` and `detail` for the reason. */
  model ProblemDetailsResponse {
    @statusCode _: 400;
    @body problem: ProblemDetails;
  }

  /** The service could not complete the request. The request may be retried. */
  model InternalServerErrorResponse {
    @statusCode _: 500;
    @body problem: ProblemDetails;
  }

  /** Optional API compatibility version. */
  model ApiVersionHeader {
    @doc("Optional API compatibility version. The SDK sends `2026-11-05`.")
    @example("2026-11-05")
    @header("X-Api-Version")
    apiVersion?: string;
  }

  @doc("Shop client API key (`sv_client_…`). Send on authenticated business API requests.")
  model ClientApiKeyHeader {
    @doc("Your shop's public client API key, received during onboarding. Not a secret; safe for browser code. Required on business API requests except the health check. OFREP evaluations use X-API-Key instead.")
    @header("X-Client-Api-Key")
    @example("sv_client_example")
    clientApiKey: string;
  }
}
