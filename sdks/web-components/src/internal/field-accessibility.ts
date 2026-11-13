/** Caller-localized field copy, resolved inside the native control's shadow root. */
export interface SvFieldAccessibilityProps {
  /** Field-specific validation error. Service failures belong to the containing screen. */
  validationError?: string | undefined;
  /** Instructions or context announced after the control's label. */
  description?: string | undefined;
}

export function fieldDescriptionIds(
  description?: string,
  error?: string,
  correction?: string,
): string | undefined {
  const ids = [
    (description?.length ?? 0) > 0 ? "field-description" : "",
    (error?.length ?? 0) > 0 ? "field-error" : "",
    (correction?.length ?? 0) > 0 ? "field-correction" : "",
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
