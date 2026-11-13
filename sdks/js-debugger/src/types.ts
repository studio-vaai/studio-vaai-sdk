import type { BodyValidationCode, StandardErrorKind } from "@studio-vaai/js-client";

import { asBodyValidationCode } from "@studio-vaai/js-client";

/** Flat key identifying an interceptable API method, e.g. `"body.createBody"`. */
export type DebugMethodId = string;

/** Standard transport/system error kinds that can be injected on any wrapped method. */
export type DebugErrorKind = StandardErrorKind;

export interface InjectedError {
  kind: DebugErrorKind;
  message: string;
}

/**
 * Inject a typed `body.createBody` validation rejection. Surfaced as a successful
 * API call (`ok: true`) whose data is `{ status: "failed", failure: { kind: "validation", … } }`,
 * matching what the real server returns for image-content rejections.
 */
export interface InjectedBodyValidationFailure {
  code: BodyValidationCode;
  /** Optional server-side message; clients should localize from `code` first. */
  message?: string;
}

export interface ApiCallLogEntry {
  id: number;
  /** `Date.now()` at call start. */
  ts: number;
  methodId: DebugMethodId;
  ok: boolean;
  durationMs: number;
  /** Short human-readable summary, e.g. `"body.createBody → ok (212ms)"`. */
  summary: string;
}

/** Locales the debugger can force on the SDK UI: the languages it ships a catalog for. */
export const DEBUG_LOCALES = ["de", "en"] as const;
export type DebugLocale = (typeof DEBUG_LOCALES)[number];

/**
 * The debugger's forced-locale contract with host apps — deliberately plain-DOM so an
 * SSR-rendered host can follow it WITHOUT importing this package (the root export registers a
 * custom element, which crashes off-browser):
 * - the forced locale persists under [`DEBUG_LOCALE_STORAGE_KEY`] (absent = host default), and
 * - every change fires a `CustomEvent<DebugLocale | null>` named [`DEBUG_LOCALE_EVENT`] on
 *   `window`.
 * Hosts read the key for the initial value and re-read it on the event (e.g. via
 * `useSyncExternalStore`), then pass the result as the UI provider's `locale`.
 */
export const DEBUG_LOCALE_STORAGE_KEY = "studio-vaai-debugger:locale";
/** See [`DEBUG_LOCALE_STORAGE_KEY`]. */
export const DEBUG_LOCALE_EVENT = "studio-vaai-debugger:locale";

export interface DebugState {
  /** Transport/system errors keyed by method id; produced as `{ ok: false, error }`. */
  injectedErrors: Partial<Record<DebugMethodId, InjectedError>>;
  /**
   * Domain validation rejections for `body.createBody`; produced as
   * `{ ok: true, data: { status: "failed", failure: ... } }`. When both are set for the
   * same method, the transport error wins (it short-circuits before the network call).
   */
  injectedBodyValidationFailures: Partial<Record<DebugMethodId, InjectedBodyValidationFailure>>;
  log: readonly ApiCallLogEntry[];
  /** SDK UI locale forced from the debugger panel; `null` = the host app's own default. */
  locale: DebugLocale | null;
}

/**
 * Method IDs surfaced as rows in the debugger UI, in display order. A subset of the methods
 * the debug client actually intercepts — `createDebugClient` also wraps e.g. `tracking.*` and
 * `experiments.*`, which are not exposed for injection here.
 */
export const ALL_METHOD_IDS: DebugMethodId[] = [
  "meta.getHealth",
  "session.createSession",
  "session.getSession",
  "session.refreshSession",
  "session.invalidateSession",
  "body.listBodies",
  "body.createBody",
  "body.setBodyHeight",
  "tryOn.getRecommendedSize",
  "tryOn.createTryOn",
  "tryOn.getTryOn",
];

/** Methods that also accept typed domain (validation) failure injection. */
export const DOMAIN_ERROR_METHOD_IDS = new Set<DebugMethodId>(["body.createBody"]);

/** All `BodyValidationCode` values in display order; matches the public contract. */
export const BODY_VALIDATION_CODES: readonly BodyValidationCode[] = [
  asBodyValidationCode("no_human_detected"),
  asBodyValidationCode("human_occluded"),
  asBodyValidationCode("human_not_standing"),
  asBodyValidationCode("human_too_small"),
  asBodyValidationCode("inappropriate_clothing"),
];

/** All standard error kinds in display order. */
export const STANDARD_ERROR_KINDS: StandardErrorKind[] = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation_error",
  "rate_limited",
  "internal_server_error",
  "service_unavailable",
  "unknown",
];
