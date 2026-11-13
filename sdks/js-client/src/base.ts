export interface CallOptions {
  signal?: AbortSignal;
}

export type StandardErrorKind =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "rate_limited"
  | "internal_server_error"
  | "service_unavailable"
  /**
   * The session ended on the server (inactivity expiry or data deletion) and
   * can never be revived — distinct from `unauthorized`: the right reaction is
   * to discard the persisted session and restart from consent, not to retry.
   */
  | "session_expired"
  /** Explicit cookie mode could not establish cookie support; no session was created. */
  | "session_transport_unavailable"
  | "unknown";

/** Non-domain failures (`{ ok: false }`): HTTP, auth, unexpected errors. */
export interface StandardError {
  kind: StandardErrorKind;
  message: string;
  details?: unknown;
}

declare const bodyValidationCodeBrand: unique symbol;

/**
 * Stable, user-actionable rejection codes from server-side image validation.
 * Mirrors `BodyValidationCode` in the public OpenAPI contract.
 *
 * Branded so consumers cannot pass an arbitrary string where a code is expected;
 * use {@link asBodyValidationCode} to widen a string literal at the API boundary.
 */
export type BodyValidationCode = (
  | "no_human_detected"
  | "human_occluded"
  | "human_not_standing"
  | "human_too_small"
  | "inappropriate_clothing"
) & { readonly [bodyValidationCodeBrand]: true };

type RawBodyValidationCode =
  | "no_human_detected"
  | "human_occluded"
  | "human_not_standing"
  | "human_too_small"
  | "inappropriate_clothing";

/** Widen a known literal into the branded {@link BodyValidationCode} type. */
export function asBodyValidationCode(code: RawBodyValidationCode): BodyValidationCode {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- branding validation codes (literal-union argument is the type-level contract)
  return code as BodyValidationCode;
}

export interface ResultMeta {
  requestId?: string | undefined;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ResultMeta;
}

export interface ApiFailure<E> {
  ok: false;
  error: E;
}

/** Success: `{ ok: true, data }`; expected API failure: `{ ok: false, error }` (no throw). */
export type ApiResult<T, E = StandardError> = ApiSuccess<T> | ApiFailure<E>;
