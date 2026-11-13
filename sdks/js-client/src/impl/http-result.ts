import type { ApiResult, StandardError } from "../base.js";
import type { ProblemDetails } from "./generated/types.gen.js";

import { isProblemDetails, networkError } from "./problem-details.js";

/** Raised inside the generated client's auth callback and returned as an ApiResult. */
export class SessionTransportError extends Error {
  override name = "SessionTransportError";
}

export function unwrapProblemOrUnknown<T>(
  result: { data?: T; error?: unknown; response?: Response },
  mapProblem: (p: ProblemDetails, httpStatus: number) => StandardError,
): ApiResult<T> {
  if (typeof result.error !== "undefined" && result.error !== null) {
    if (result.error instanceof SessionTransportError) {
      return {
        ok: false,
        error: {
          kind: "bad_request",
          message: result.error.message,
          details: { kind: "session-transport-mismatch" },
        },
      };
    }
    if (isProblemDetails(result.error)) {
      const httpStatus = result.response?.status ?? 500;
      return { ok: false, error: mapProblem(result.error, httpStatus) };
    }
    return { ok: false, error: networkError("Request failed", result.error) };
  }
  if (typeof result.data === "undefined") {
    return { ok: false, error: { kind: "unknown", message: "Empty API response" } };
  }
  return { ok: true, data: result.data };
}
