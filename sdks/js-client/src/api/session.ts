import type { ApiResult, CallOptions } from "../base.js";
import type { SessionHandle } from "../types.js";

export type SessionTransport = "cookie" | "bearer";
export type SessionTransportPreference = SessionTransport | "auto";

/** Call only after the user has granted studio vaai data-processing consent. */
export interface CreateSessionArgs {
  dataProcessingConsent: true;
}

export interface SessionData {
  session: SessionHandle;
  /** Actual transport; optional for compatibility with custom clients. */
  sessionTransport?: SessionTransport;
  expiresAt?: string;
}

export interface GetSessionArgs {
  session: SessionHandle;
}

/** Extends TTL and rotates credentials. Always save the returned handle. */
export interface RefreshSessionArgs {
  session: SessionHandle;
}

export interface InvalidateSessionArgs {
  session: SessionHandle;
}

export type InvalidateSessionData = Record<string, never>;

export interface SessionApi {
  createSession(args: CreateSessionArgs, options?: CallOptions): Promise<ApiResult<SessionData>>;

  getSession(args: GetSessionArgs, options?: CallOptions): Promise<ApiResult<SessionData>>;

  refreshSession(args: RefreshSessionArgs, options?: CallOptions): Promise<ApiResult<SessionData>>;

  invalidateSession(
    args: InvalidateSessionArgs,
    options?: CallOptions,
  ): Promise<ApiResult<InvalidateSessionData>>;
}
