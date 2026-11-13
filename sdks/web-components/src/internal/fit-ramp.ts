/* oxlint-disable unicorn/numeric-separators-style -- the OKLab matrices below are transcribed
   verbatim from Ottosson's reference implementation; grouping their digits would make them
   impossible to diff against the source. */

import type { SvAppearance } from "./theme/tokens.js";

/**
 * The fit score's color ramp, red → amber → green at the score's own position. Ported as-is
 * from the React SDK (`fit-score-ramp.ts`). Dark appearance keeps the same hue journey
 * on a deeper, quieter surface so the light label stays readable.
 *
 * Resolved in JS to a plain `rgb()` on purpose: a `color-mix()` or gradient interpolation
 * method that a shop's browser can't parse takes the whole background with it, and a semantic
 * scale (red means "won't fit") must not vanish. So it isn't themeable through tokens either.
 */

/** An OKLCH anchor: `at` is the score it applies to, then lightness, chroma, hue°. */
interface RampStop {
  at: number;
  l: number;
  c: number;
  h: number;
}

/**
 * Near-constant lightness (a hue journey, not light to dark), so the near-black label keeps
 * ≥ 6.9:1 contrast at every score and every step stays in sRGB.
 */
const RAMP: readonly RampStop[] = [
  { at: 0, l: 0.7, c: 0.172, h: 25 },
  { at: 50, l: 0.8808, c: 0.1242, h: 96.8 },
  { at: 100, l: 0.845, c: 0.135, h: 152 },
];

function encodeSrgb(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** OKLCH → sRGB (Björn Ottosson's reference). Clamped: the ramp is chosen to stay in gamut. */
function oklchToRgb(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((linear) => Math.round(Math.min(255, Math.max(0, encodeSrgb(linear) * 255))));
  return `rgb(${channels.map(String).join(" ")})`;
}

/** The ramp color for a score; outside 0–100 clamps to the end anchors. */
export function fitScoreTint(score: number, appearance: SvAppearance = "light"): string {
  const p = Math.min(100, Math.max(0, score));
  const upper = p > 50 ? 2 : 1;
  const from = RAMP[upper - 1];
  const to = RAMP[upper];
  if (from === undefined || to === undefined) {
    return "rgb(0 0 0)";
  }
  const t = (p - from.at) / (to.at - from.at);
  // Linear per OKLCH axis; the hues run 25° → 97° → 152°, so the direct path is the short one.
  const lightness = from.l + (to.l - from.l) * t;
  const chroma = from.c + (to.c - from.c) * t;
  return oklchToRgb(
    appearance === "dark" ? 0.38 : lightness,
    appearance === "dark" ? Math.min(chroma * 0.65, 0.09) : chroma,
    from.h + (to.h - from.h) * t,
  );
}

/**
 * The tint fades in from the appearance's glass surface. The render still reads through the
 * left half, without a flash of white behind dark-mode labels.
 */
export function fitScoreGradient(score: number, appearance: SvAppearance = "light"): string {
  const start = appearance === "dark" ? "var(--_sv-glass)" : "rgb(255 255 255 / 0.72)";
  return `linear-gradient(90deg, ${start} 0%, ${fitScoreTint(score, appearance)} 100%)`;
}
