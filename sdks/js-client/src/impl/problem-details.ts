import type { StandardError, StandardErrorKind } from "../base.js";
import type { ProblemDetails } from "./generated/types.gen.js";

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "title" in value &&
    typeof (value as { title: unknown }).title === "string"
  );
}

export function httpStatusToKind(status: number): StandardErrorKind {
  if (status === 400) {
    return "bad_request";
  }
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 422) {
    return "validation_error";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 503) {
    return "service_unavailable";
  }
  if (status === 500 || status === 502 || status === 504) {
    return "internal_server_error";
  }
  return "unknown";
}

export function problemDetailsToStandardError(
  details: ProblemDetails,
  httpStatus: number,
): StandardError {
  // Typed server codes take precedence over the coarse HTTP-status mapping.
  // `session-expired` is terminal (the session was idle-expired or its data
  // deleted); clients must restart from consent rather than retry.
  let kind = httpStatusToKind(httpStatus);
  if (details.kind === "session-expired") {
    kind = "session_expired";
  }
  if (details.kind === "session-cookie-unavailable") {
    kind = "session_transport_unavailable";
  }
  return {
    kind,
    message: details.detail ?? details.title,
    details,
  };
}

export function networkError(message: string, cause?: unknown): StandardError {
  return {
    kind: "unknown",
    message,
    details: cause,
  };
}
