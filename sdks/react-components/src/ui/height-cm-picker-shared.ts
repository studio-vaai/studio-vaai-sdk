export const MIN_CM = 140;
export const MAX_CM = 220;

/** Mathematically round to the nearest cm, then clamp to `[MIN_CM, MAX_CM]`. */
export function normalizeCm(n: number): number {
  return Math.max(MIN_CM, Math.min(MAX_CM, Math.round(n)));
}

export interface HeightCmPickerProps {
  valueCm: number;
  onChange: (cm: number) => void;
  /** When true, the picker is disabled (e.g. while height save is in flight). */
  disabled?: boolean;
  /**
   * Element id whose visible text labels this control (typically the screen's
   * section heading). Set as `aria-labelledby` on the spinbutton input/wheel so
   * AT announces e.g. "Wie groß bist du?" instead of a hardcoded fallback.
   */
  "aria-labelledby"?: string;
}
