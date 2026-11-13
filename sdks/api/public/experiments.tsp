import "./core.tsp";
import "@typespec/openapi3";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace StudioVaai {
  // OFREP 0.4.0 core profile. Reference revision: 98c4e0de5583c0d79dd938b82975c80125335e92.
  // https://github.com/open-feature/protocol/blob/98c4e0de5583c0d79dd938b82975c80125335e92/service/openapi.yaml
  // Streaming, metadata, variant labels, and code-default results are omitted.

  @doc("Identifies the shop with its public client API key (`sv_client_…`) in X-API-Key. No shopper session is required.")
  model OfrepApiKeyAuth is ApiKeyAuth<ApiKeyLocation.header, "X-API-Key">;

  @doc("Context used to evaluate flags. Additional attributes are accepted; the current rollout uses targetingKey.")
  model OfrepEvaluationContext extends Record<unknown> {
    @doc("Stable anonymous visitor identifier. Reuse it across requests. The try-on-enabled flag requires this field and reports TARGETING_KEY_MISSING when it is absent.")
    targetingKey?: string;
  }

  @doc("Context for a single or bulk flag evaluation. Send an empty context object when evaluating flags that do not require visitor information.")
  @example(#{ context: #{ targetingKey: "visitor-123" } })
  model OfrepEvaluationRequest {
    context: OfrepEvaluationContext;
  }

  @doc("An explicit boolean, string, numeric, or object value. Disabled boolean flags use false; they are not omitted.")
  @oneOf
  union OfrepFlagValue {
    booleanValue: boolean,
    stringValue: string,
    numericValue: float64,
    objectValue: Record<unknown>,
  }

  // OFREP 0.4.0 evaluation reasons and per-flag error codes.
  alias OfrepEvaluationReason =
    | "STATIC"
    | "TARGETING_MATCH"
    | "SPLIT"
    | "DISABLED"
    | "UNKNOWN";

  alias OfrepEvaluationErrorCode =
    | "PARSE_ERROR"
    | "TARGETING_KEY_MISSING"
    | "INVALID_CONTEXT"
    | "GENERAL";

  @doc("A successfully evaluated flag. This profile always returns an explicit value.")
  @example(#{ key: "try-on-enabled", value: true, reason: "SPLIT" })
  model OfrepEvaluationSuccess {
    @doc("Stable flag key. The initial flag is try-on-enabled; additional keys can be introduced later.")
    key: string;

    @doc("Evaluated value. A boolean false is a successful off decision, not an evaluation error.")
    value: OfrepFlagValue;

    @doc("Why the flag resolved to this value.")
    reason: OfrepEvaluationReason;
  }

  @error
  @doc("Details of an unexpected service failure.")
  model OfrepError {
    @doc("Optional explanation for diagnostics.")
    errorDetails?: string;
  }

  @error
  @doc("A flag could not be evaluated. The client should use its configured default for this flag; no value is returned.")
  @example(#{ key: "try-on-enabled", errorCode: "TARGETING_KEY_MISSING" })
  model OfrepEvaluationFailure extends OfrepError {
    key: string;
    errorCode: OfrepEvaluationErrorCode;
  }

  @error
  @doc("The entire bulk request is invalid. Individual flag failures belong in a successful bulk response instead.")
  model OfrepBulkEvaluationFailure extends OfrepError {
    errorCode: OfrepEvaluationErrorCode;
  }

  @error
  @doc("The requested flag key does not exist for this shop.")
  model OfrepFlagNotFound extends OfrepError {
    key: string;
    errorCode: "FLAG_NOT_FOUND";
  }

  @doc("One flag result: either an evaluated value or an evaluation error. A result never contains both.")
  @oneOf
  union OfrepFlagEvaluation {
    success: OfrepEvaluationSuccess,
    failure: OfrepEvaluationFailure,
  }

  @doc("All flags available to the shop, including off decisions and any per-flag errors. An empty flags array means no flags are available, not that every flag is off.")
  @example(#{
    flags: #[#{ key: "try-on-enabled", value: false, reason: "SPLIT" }],
  })
  model OfrepBulkEvaluationSuccess {
    flags: OfrepFlagEvaluation[];
  }

  model OfrepJsonErrorResponse<Status extends int32, Error extends OfrepError>
    extends NoStoreResponseHeaders {
    @statusCode _: Status;
    @header("Content-Type") contentType: "application/json";
    @body error: Error;
  }

  @doc("The flag evaluation request is invalid or its context does not meet the flag's requirements.")
  model OfrepEvaluationBadRequestResponse
    is OfrepJsonErrorResponse<400, OfrepEvaluationFailure>;

  @doc("The bulk request or its context is invalid.")
  model OfrepBulkBadRequestResponse
    is OfrepJsonErrorResponse<400, OfrepBulkEvaluationFailure>;

  @doc("The requested flag key does not exist for this shop.")
  model OfrepFlagNotFoundResponse
    is OfrepJsonErrorResponse<404, OfrepFlagNotFound>;

  @doc("The service could not complete the evaluation.")
  model OfrepInternalServerErrorResponse
    is OfrepJsonErrorResponse<500, OfrepError>;

  @doc("The shop API key is missing or invalid.")
  model OfrepUnauthorizedResponse extends NoStoreResponseHeaders {
    @statusCode _: 401;

    @doc("Authentication challenge for this service's API-key authentication.")
    @header("WWW-Authenticate")
    wwwAuthenticate: string;

    @body body: void;
  }

  @doc("Access to the shop's flags is not allowed for this request.")
  model OfrepForbiddenResponse extends NoStoreResponseHeaders {
    @statusCode _: 403;
    @body body: void;
  }

  @doc("The request was rate-limited. Wait until Retry-After before sending another evaluation request.")
  model OfrepRateLimitedResponse extends NoStoreResponseHeaders {
    @statusCode _: 429;

    @doc("When to retry, expressed as an HTTP date or a delay in seconds.")
    @example("5")
    @header("Retry-After")
    retryAfter: string;

    @body body: void;
  }

  @doc("Headers for bulk results and cache validation. These responses are private and must be revalidated before reuse.")
  model OfrepBulkResponseHeaders {
    @header("Cache-Control") cacheControl: "private, no-cache";

    @doc("Opaque quoted validator for the evaluated result, scoped to the shop and supplied context. Send it in If-None-Match on the next bulk request. A changed context or result must not reuse a validator that would preserve a stale decision.")
    @example("\"flags-example\"")
    @header("ETag")
    eTag: string;
  }

  // Browser clients need CORS exposure of ETag, Retry-After, and WWW-Authenticate.
  @doc("OFREP 0.4.0 core evaluation with API-key authentication and polling. Use the shop's public client key in X-API-Key. No shopper session or business API version header is required. Streaming and optional metadata are not provided. The initial flag, try-on-enabled, controls whether to show the try-on entry point.")
  @tag("experiments")
  @route("/ofrep/v1/evaluate/flags")
  @useAuth(OfrepApiKeyAuth)
  interface Experiments {
    @post
    @route("/{key}")
    @operationId("evaluateFlag")
    @summary("Evaluate a flag")
    @doc("Evaluate a flag for the supplied context. Returns its value and reason on success, 400 for an evaluation failure, or 404 for an unknown key. Disabled flags return a successful value of false. Evaluation errors never masquerade as off decisions.")
    evaluateFlag(
      @doc("Flag key to evaluate, such as try-on-enabled.")
      @path
      key: string,

      @body body: OfrepEvaluationRequest,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body evaluation: OfrepEvaluationSuccess;
        }
      | OfrepEvaluationBadRequestResponse
      | OfrepFlagNotFoundResponse
      | OfrepUnauthorizedResponse
      | OfrepForbiddenResponse
      | OfrepRateLimitedResponse
      | OfrepInternalServerErrorResponse;

    @post
    @operationId("evaluateFlagsBulk")
    @summary("Evaluate all flags")
    @doc("Evaluate all flags available to the shop for the supplied context. The 200 response includes off values and individual flag errors; a failure affecting one flag does not discard other results. Use ETag and If-None-Match for polling. After validating the API key and request context, return 304 with no body only when the evaluated result is unchanged for this shop and context.")
    evaluateFlagsBulk(
      @doc("ETag from a previous bulk response. An unchanged evaluated result returns 304; otherwise a complete 200 response replaces the previous flag set.")
      @header("If-None-Match")
      ifNoneMatch?: string,

      @body body: OfrepEvaluationRequest,
    ):
      | {
          ...OfrepBulkResponseHeaders;
          @statusCode _: 200;
          @body evaluation: OfrepBulkEvaluationSuccess;
        }
      | {
          ...OfrepBulkResponseHeaders;
          @statusCode _: 304;
        }
      | OfrepBulkBadRequestResponse
      | OfrepUnauthorizedResponse
      | OfrepForbiddenResponse
      | OfrepRateLimitedResponse
      | OfrepInternalServerErrorResponse;
  }
}
