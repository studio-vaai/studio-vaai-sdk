/** Thrown by {@link createClient} in the contract-only package (no HTTP transport). */
export class StudioVaaiClientNotImplementedError extends Error {
  readonly code = "studio_vaai_client_not_implemented" as const;

  constructor() {
    super(
      "@studio-vaai/js-client: createClient has no runtime implementation; use a transport package that implements StudioVaaiClient.",
    );
    this.name = "StudioVaaiClientNotImplementedError";
  }
}

/**
 * Wraps a failed {@link ApiResult} payload so `catch` receives an `Error` with
 * {@link failure} holding the original `error` value (e.g. {@link StandardError}).
 */
export class ApiFailureError extends Error {
  readonly failure: unknown;

  constructor(failure: unknown, message?: string) {
    super(message ?? messageFromFailure(failure));
    this.name = "ApiFailureError";
    this.failure = failure;
  }
}

function messageFromFailure(failure: unknown): string {
  if (typeof failure === "object" && failure !== null && "message" in failure) {
    const m = failure.message;
    if (typeof m === "string") {
      return m;
    }
  }
  return "API request failed";
}
