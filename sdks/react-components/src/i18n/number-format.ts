/**
 * Unit and percent formatting for the bundle's locale (`StudioVaaiUiMessages.locale`), so
 * `de` reads "85 %" and `ar` writes its own unit name, where string concatenation would
 * hard-code the English "85%" / "175cm".
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(
  locale: string,
  kind: "centimeter" | "percent",
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${kind}|${locale}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

function centimeterFormat(locale: string): Intl.NumberFormat {
  return formatter(locale, "centimeter", {
    style: "unit",
    unit: "centimeter",
    maximumFractionDigits: 0,
  });
}

/** A whole-centimetre length, e.g. `"175 cm"`. */
export function formatCentimeters(locale: string, cm: number): string {
  return centimeterFormat(locale).format(Math.round(cm));
}

const NUMBER_PART_TYPES = new Set(["integer", "group", "decimal", "fraction", "minusSign"]);

/**
 * The text around the number in {@link formatCentimeters}, for a control that draws the
 * number itself (an input) and the unit beside it. Whitespace at the joins is trimmed: the
 * layout supplies the gap.
 */
export function centimeterAffixes(locale: string, cm: number): { prefix: string; suffix: string } {
  const parts = centimeterFormat(locale).formatToParts(Math.round(cm));
  const first = parts.findIndex((p) => NUMBER_PART_TYPES.has(p.type));
  const last = parts.findLastIndex((p) => NUMBER_PART_TYPES.has(p.type));
  const join = (from: number, to: number): string =>
    parts
      .slice(from, to)
      .map((p) => p.value)
      .join("")
      .trim();
  if (first === -1) {
    return { prefix: "", suffix: join(0, parts.length) };
  }
  return { prefix: join(0, first), suffix: join(last + 1, parts.length) };
}

/** A whole percentage from a 0–100 value, e.g. `"85%"` (en) or `"85 %"` (de). */
export function formatPercent(locale: string, pct: number): string {
  return formatter(locale, "percent", { style: "percent", maximumFractionDigits: 0 }).format(
    pct / 100,
  );
}
