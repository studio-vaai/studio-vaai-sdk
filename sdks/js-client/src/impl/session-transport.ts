import type {
  SessionApi,
  SessionData,
  SessionTransport,
  SessionTransportPreference,
} from "../api/session.js";
import type { ApiResult } from "../base.js";
import type { SessionHandle } from "../types.js";
import type { Client } from "./generated/client/index.js";
import type { BearerSessionCreated, CookieSessionCreated } from "./generated/types.gen.js";

import { sessionHandleFromApi } from "../types.js";
import {
  createBearerSession,
  createCookieSession,
  prepareCookieSession,
  deleteSession,
  getSession,
  refreshBearerSession,
  refreshCookieSession,
} from "./generated/sdk.gen.js";
import { SessionTransportError, unwrapProblemOrUnknown } from "./http-result.js";
import { problemDetailsToStandardError } from "./problem-details.js";

const COOKIE_HANDLE_PREFIX = "studio-vaai:cookie-session:";

/** A cookie handle identifies transport/scope; it never contains the cookie credential. */
function isCookieHandle(session: SessionHandle): boolean {
  return session.startsWith(COOKIE_HANDLE_PREFIX);
}

export interface SessionRequestOptions {
  credentials: "include" | "omit";
  security: { type: "http"; scheme: "bearer" }[];
  auth: () => SessionHandle | undefined;
}

export function sessionRequestOptions(
  session: SessionHandle,
  cookieHandle: SessionHandle,
  mode: SessionTransportPreference,
): SessionRequestOptions {
  const cookie = isCookieHandle(session);
  return {
    credentials: cookie ? ("include" as const) : ("omit" as const),
    // Override codegen's OR security list. Browsers manage the HttpOnly cookie;
    // never copy a bearer token into a Cookie header or send the marker as auth.
    security: [{ type: "http" as const, scheme: "bearer" as const }],
    auth: (): SessionHandle | undefined => {
      if (
        (cookie && session !== cookieHandle) ||
        (mode === "cookie" && !cookie) ||
        (mode === "bearer" && cookie)
      ) {
        throw new SessionTransportError(
          "Session handle does not match this client's transport or shop/API scope.",
        );
      }
      return cookie ? globalThis.undefined : session;
    },
  };
}

function invalidResponse(message: string): ApiResult<never> {
  return { ok: false, error: { kind: "unknown", message } };
}

export function createSessionTransport(config: {
  http: Client;
  headers: { "X-Client-Api-Key": string; "X-Api-Version": string };
  mode: SessionTransportPreference;
  browser: boolean;
  scope: string;
}): {
  api: SessionApi;
  requestOptions: (session: SessionHandle) => ReturnType<typeof sessionRequestOptions>;
} {
  const { http, headers, mode } = config;
  const cookieHandle = sessionHandleFromApi(
    `${COOKIE_HANDLE_PREFIX}${encodeURIComponent(config.scope)}`,
  );
  const requestOptions = (session: SessionHandle) =>
    sessionRequestOptions(session, cookieHandle, mode);

  function sessionData(
    data: BearerSessionCreated | CookieSessionCreated,
    transport: SessionTransport,
  ): ApiResult<SessionData> {
    if (
      data === null ||
      typeof data !== "object" ||
      typeof data.expiresAt !== "string" ||
      !data.expiresAt
    ) {
      return invalidResponse("Expected session expiry metadata.");
    }
    if (transport === "cookie") {
      if ("token" in data) {
        return invalidResponse("Expected a cookie session response without a token.");
      }
      return {
        ok: true,
        data: { session: cookieHandle, sessionTransport: "cookie", expiresAt: data.expiresAt },
      };
    }
    if (
      !("token" in data) ||
      typeof data.token !== "string" ||
      data.token.length === 0 ||
      data.token.startsWith(COOKIE_HANDLE_PREFIX)
    ) {
      return invalidResponse("Expected a bearer session token.");
    }
    return {
      ok: true,
      data: {
        session: sessionHandleFromApi(data.token),
        sessionTransport: "bearer",
        expiresAt: data.expiresAt,
      },
    };
  }

  const api: SessionApi = {
    createSession: async (args, options) => {
      if (!args.dataProcessingConsent) {
        return {
          ok: false,
          error: {
            kind: "bad_request",
            message: "Data processing consent is required.",
            details: { kind: "consent-required" },
          },
        };
      }
      let cookie = mode !== "bearer" && (mode === "cookie" || config.browser);
      let raw;
      if (cookie) {
        const preparation = unwrapProblemOrUnknown(
          await prepareCookieSession({
            client: http,
            headers,
            credentials: "include",
            signal: options?.signal,
          }),
          problemDetailsToStandardError,
        );
        if (!preparation.ok) {
          return preparation;
        }
        if (
          typeof preparation.data.challenge !== "string" ||
          preparation.data.challenge.length === 0
        ) {
          return invalidResponse("Missing cookie preparation challenge.");
        }
        raw = await createCookieSession({
          client: http,
          headers,
          credentials: "include",
          signal: options?.signal,
          body: { dataProcessingConsent: true, cookieChallenge: preparation.data.challenge },
        });
        // Only this explicit response guarantees that no shopper/session was created.
        // Preparation errors, network failures and actual-session verification never downgrade.
        if (
          mode === "auto" &&
          raw.response?.status === 400 &&
          raw.error &&
          "kind" in raw.error &&
          raw.error.kind === "session-cookie-unavailable"
        ) {
          cookie = false;
        }
      }
      if (!cookie) {
        raw = await createBearerSession({
          client: http,
          headers,
          credentials: "omit",
          signal: options?.signal,
          body: { dataProcessingConsent: true },
        });
      }
      if (typeof raw === "undefined") {
        return invalidResponse("Session creation did not return a response.");
      }
      const created = unwrapProblemOrUnknown<BearerSessionCreated | CookieSessionCreated>(
        raw,
        problemDetailsToStandardError,
      );
      if (!created.ok) {
        return created;
      }
      const result = sessionData(created.data, cookie ? "cookie" : "bearer");
      if (!result.ok || !cookie) {
        return result;
      }
      // Preparation verification can succeed and the real cookie still fail (policy changes,
      // races, quota). Verify the actual session; never downgrade it afterward.
      const restored = await api.getSession({ session: result.data.session }, options);
      return restored.ok ? result : restored;
    },
    getSession: async (args, options) => {
      const result = unwrapProblemOrUnknown(
        await getSession({
          client: http,
          headers,
          ...requestOptions(args.session),
          signal: options?.signal,
        }),
        problemDetailsToStandardError,
      );
      return result.ok
        ? {
            ok: true,
            data: {
              session: args.session,
              sessionTransport: isCookieHandle(args.session) ? "cookie" : "bearer",
              expiresAt: result.data.expiresAt,
            },
          }
        : result;
    },
    refreshSession: async (args, options) => {
      const result = unwrapProblemOrUnknown(
        await (isCookieHandle(args.session) ? refreshCookieSession : refreshBearerSession)({
          client: http,
          headers,
          ...requestOptions(args.session),
          signal: options?.signal,
        }),
        problemDetailsToStandardError,
      );
      return result.ok
        ? sessionData(result.data, isCookieHandle(args.session) ? "cookie" : "bearer")
        : result;
    },
    invalidateSession: async (args, options) => {
      const raw = await deleteSession({
        client: http,
        headers,
        ...requestOptions(args.session),
        signal: options?.signal,
      });
      if (raw.response?.ok === true && (typeof raw.error === "undefined" || raw.error === null)) {
        return { ok: true, data: {} };
      }
      const result = unwrapProblemOrUnknown(raw, problemDetailsToStandardError);
      return result.ok ? invalidResponse("Unexpected delete-session response.") : result;
    },
  };
  return { api, requestOptions };
}
