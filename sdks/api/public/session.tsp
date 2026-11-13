import "./core.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

namespace StudioVaai {
  // Shopper sessions

  @error
  @doc("A session request has missing, malformed, or conflicting input.")
  model SessionBadRequestProblem extends ProblemDetails {
    kind: ShopOnlyBadRequestProblemKind | "consent-required";
  }

  @error
  @doc("The preparation challenge is missing, invalid, expired, or scoped to another shop or Origin, or its returned cookie does not match. Restart preparation; do not fall back to bearer on this error. No shopper, session, or consent record is created.")
  model CookieSessionPreparationInvalidProblem extends ProblemDetails {
    kind: "session-preparation-invalid";
  }

  @error
  @doc("The preparation challenge is valid, but the browser did not return its cookie. The integration may choose to create a bearer session instead. No shopper, session, or consent record is created.")
  model CookieSessionUnavailableProblem extends ProblemDetails {
    kind: "session-cookie-unavailable";
  }

  @error
  @doc("The service could not complete the session operation. This does not indicate that cookies are unavailable.")
  model SessionInternalServerErrorProblem extends ProblemDetails {
    kind:
      | CommonInternalServerErrorProblemKind
      | "session-preparation-failed"
      | "session-creation-failed"
      | "session-refresh-failed"
      | "session-delete-failed";
  }

  @doc("The request has missing, malformed, or conflicting input.")
  model SessionBadRequestResponse
    is NoStoreProblemResponse<400, SessionBadRequestProblem>;

  @doc("Cookie preparation is invalid. Restart preparation; no session was created.")
  model CookieSessionPreparationInvalidResponse
    is NoStoreProblemResponse<400, CookieSessionPreparationInvalidProblem>;

  @doc("The browser did not return the preparation cookie. No session was created.")
  model CookieSessionUnavailableResponse
    is NoStoreProblemResponse<400, CookieSessionUnavailableProblem>;

  @doc("The service could not complete the session operation.")
  model SessionInternalServerErrorResponse
    is NoStoreProblemResponse<500, SessionInternalServerErrorProblem>;

  @doc("Consent and cookie preparation challenge for creating a cookie session. Obtain consent before creating the session.")
  model CreateCookieSessionBody {
    @doc("The shopper has explicitly consented to processing their photo and body measurements. Must be `true`.")
    dataProcessingConsent: true;

    @doc("Challenge returned by prepareCookieSession. Send unchanged within 60 seconds, using the same shop client key and registered Origin, with credentials included so the browser can return the preparation cookie. The challenge is not a session credential.")
    cookieChallenge: string;
  }

  @doc("The shopper's explicit consent to process their photo and body measurements. Obtain consent before creating a bearer session.")
  model CreateBearerSessionBody {
    @doc("The shopper has explicitly consented to processing their photo and body measurements. Must be `true`.")
    dataProcessingConsent: true;
  }

  @doc("Created cookie session metadata. The credential is delivered only through Set-Cookie and is inaccessible to JavaScript.")
  model CookieSessionCreated {
    @doc("Session expiry time in RFC 3339 format (UTC).")
    @example(utcDateTime.fromISO("2026-10-01T12:00:00Z"))
    expiresAt: utcDateTime;
  }

  @doc("Created bearer session and its credential.")
  model BearerSessionCreated {
    @doc("Send as `Authorization: Bearer <session_token>` on shopper-specific requests, with credentials omitted.")
    @example("SESSION_TOKEN")
    token: string;

    @doc("Session expiry time in RFC 3339 format (UTC).")
    @example(utcDateTime.fromISO("2026-10-01T12:00:00Z"))
    expiresAt: utcDateTime;
  }

  @doc("Session metadata for the current Bearer or cookie session.")
  model SessionView {
    @doc("Session expiry time in RFC 3339 format (UTC).")
    expiresAt: utcDateTime;
  }

  @doc("Refreshed cookie session metadata. The replacement credential is delivered only through Set-Cookie.")
  model CookieSessionRefreshed {
    @doc("Session expiry time in RFC 3339 format (UTC).")
    expiresAt: utcDateTime;
  }

  @doc("Refreshed bearer session and its replacement credential.")
  model BearerSessionRefreshed {
    @doc("Replacement session token; stop using the previous token after a successful refresh.")
    token: string;

    @doc("Session expiry time in RFC 3339 format (UTC).")
    expiresAt: utcDateTime;
  }

  @doc("Preparation for cookie session creation. No shopper, session, or consent record is created.")
  model CookieSessionPreparation {
    @doc("A non-authenticating challenge valid for 60 seconds and bound to the shop and Origin. Pass unchanged as cookieChallenge to createCookieSession. The server validates issuance, expiry, and scope independently of whether the preparation cookie is returned.")
    challenge: string;
  }

  @doc("Create and manage shopper sessions. Every success and error response includes Cache-Control: no-store. All errors use application/problem+json. Client errors are 400 for invalid input, 401 for invalid session authentication, and 403 for refused shop, Origin, or session access.")
  @tag("session")
  interface Session {
    @post
    @route("/session/cookie/prepare")
    @operationId("prepareCookieSession")
    @summary("Prepare cookie-based session creation")
    @useAuth(NoAuth)
    @doc("Call once with credentials included, the shop client key, a registered Origin, and no Authorization header. No request body is required. Sets a temporary, non-authenticating shop-scoped cookie with Secure, HttpOnly, SameSite=None, Partitioned, and a 60-second lifetime, and returns a challenge. No shopper, session, or consent record is created. Next call createCookieSession with the challenge and credentials included; cookie verification happens during creation. Preparation alone does not establish cookie support or verify browser enforcement of partition isolation. Bearer session creation does not require preparation.")
    prepareCookieSession(...ApiVersionHeader, ...ClientApiKeyHeader):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @header("Set-Cookie") setCookie: string;
          @body preparation: CookieSessionPreparation;
        }
      | SessionBadRequestResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;

    @post
    @route("/session/cookie")
    @operationId("createCookieSession")
    @summary("Create a cookie shopper session")
    @useAuth(NoAuth)
    @doc("Create a cookie session after obtaining the shopper's consent. First call prepareCookieSession, then send its challenge as cookieChallenge with credentials included, the same shop client key and registered Origin, and no Authorization header. The server validates the challenge and checks its preparation cookie before creating a shopper, session, or consent record. Missing, invalid, expired, or incorrectly scoped challenges, or a present but mismatched preparation cookie, return session-preparation-invalid. A valid challenge with no preparation cookie returns session-cookie-unavailable. Both errors leave the shopper, session, and consent record uncreated; this operation never creates a bearer session. Success sets a shop-scoped Secure, HttpOnly, SameSite=None, Partitioned session cookie without exposing the token in JSON. Use credentials: include on subsequent requests. Verify the actual session with getSession; a failed verification must not trigger automatic bearer fallback.")
    createCookieSession(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @body body: CreateCookieSessionBody,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 201;
          @header("Set-Cookie") setCookie: string;
          @body session: CookieSessionCreated;
        }
      | SessionBadRequestResponse
      | CookieSessionPreparationInvalidResponse
      | CookieSessionUnavailableResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;

    @post
    @route("/session/bearer")
    @operationId("createBearerSession")
    @summary("Create a bearer shopper session")
    @useAuth(NoAuth)
    @doc("Create a bearer session after obtaining the shopper's consent. Send X-Client-Api-Key, omit Authorization, and use credentials: omit. No cookie preparation or challenge is required. Returns the session token in JSON and does not set a session cookie. Send the token as Authorization: Bearer <session_token> on subsequent requests, with credentials omitted.")
    createBearerSession(
      ...ApiVersionHeader,
      ...ClientApiKeyHeader,
      @body body: CreateBearerSessionBody,
    ):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 201;
          @body session: BearerSessionCreated;
        }
      | SessionBadRequestResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;

    @get
    @route("/session")
    @operationId("getSession")
    @summary("Get the current session")
    @doc("Retrieve the expiry time of the current Bearer or cookie session. Requires the shop client API key.")
    getSession(...ApiVersionHeader, ...ClientApiKeyHeader):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body session: SessionView;
        }
      | SessionBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;

    @post
    @route("/session/cookie/refresh")
    @operationId("refreshCookieSession")
    @summary("Refresh the current cookie session")
    @useAuth(SessionCookieAuth)
    @doc("Replace the current cookie session credential and extend the session. Send the shop client key and session cookie with credentials included, a registered Origin, and no Authorization header. Cookie preparation is not required. Returns expiry metadata and sets a replacement HttpOnly session cookie without exposing the credential in JSON. The previous credential becomes invalid. Bearer credentials are not accepted on this endpoint.")
    refreshCookieSession(...ApiVersionHeader, ...ClientApiKeyHeader):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @header("Set-Cookie") setCookie: string;
          @body session: CookieSessionRefreshed;
        }
      | SessionBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;

    @post
    @route("/session/bearer/refresh")
    @operationId("refreshBearerSession")
    @summary("Refresh the current bearer session")
    @useAuth(BearerAuth)
    @doc("Replace the current bearer session token and extend the session. Send the shop client key and Authorization: Bearer <session_token> with credentials omitted. Returns the replacement token in JSON and does not set a session cookie. The previous credential becomes invalid. Cookie credentials are not accepted on this endpoint.")
    refreshBearerSession(...ApiVersionHeader, ...ClientApiKeyHeader):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 200;
          @body session: BearerSessionRefreshed;
        }
      | SessionBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;

    @delete
    @route("/session")
    @operationId("deleteSession")
    @summary("Delete the current session")
    @doc("End the current Bearer or cookie session. Invalidates the credential and clears the cookie in cookie mode.")
    deleteSession(...ApiVersionHeader, ...ClientApiKeyHeader):
      | {
          ...NoStoreResponseHeaders;
          @statusCode _: 204;
          @header("Set-Cookie") setCookie?: string;
        }
      | SessionBadRequestResponse
      | SessionUnauthorizedResponse
      | SessionForbiddenResponse
      | SessionInternalServerErrorResponse;
  }
}
