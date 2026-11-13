/** Stable codes for {@link StudioVaaiProviderError} (dev and production). */
export const StudioVaaiProviderErrorCode = {
  MissingProvider: "MISSING_PROVIDER",
} as const;

export type StudioVaaiProviderErrorCode =
  (typeof StudioVaaiProviderErrorCode)[keyof typeof StudioVaaiProviderErrorCode];

const messages: Record<StudioVaaiProviderErrorCode, string> = {
  [StudioVaaiProviderErrorCode.MissingProvider]:
    "StudioVaai hooks must be used within StudioVaaiProvider.",
};

/**
 * Thrown when a StudioVaai hook runs outside a `StudioVaaiProvider`. Carries a
 * stable {@link StudioVaaiProviderErrorCode} so callers can branch on `code`
 * rather than the human-readable message.
 */
export class StudioVaaiProviderError extends Error {
  readonly code: StudioVaaiProviderErrorCode;

  constructor(code: StudioVaaiProviderErrorCode) {
    super(messages[code]);
    this.name = "StudioVaaiProviderError";
    this.code = code;
  }
}
