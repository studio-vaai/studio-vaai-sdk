/* oxlint-disable unicorn/numeric-separators-style -- the OKLab matrices below are transcribed
   verbatim from Ottosson's reference implementation; grouping their digits would make them
   impossible to diff against the source they came from. */

/**
 * The fit-score colour ramp: red → amber → green, sampled at the score's own position.
 *
 * The interpolation runs in OKLCH and is resolved here, in JS, rather than handed to CSS as a
 * `color-mix()`. Two reasons, both learned the hard way:
 *
 * - A `color-mix()` (or a gradient `<color-interpolation-method>`) that any client fails to
 *   parse takes the WHOLE `background-image` down with it, and the ribbon renders as a blank
 *   white bar — a silent, total failure rather than a degraded one. This SDK renders inside
 *   other people's pages; it does not get to pick the browser.
 * - Same for the anchors as custom properties: a host stylesheet that is a version behind (or
 *   simply overrides the palette) leaves `var()` unresolved, and again the whole declaration
 *   dies. The ramp is semantic — red means "this will not fit" — so it should not be able to
 *   vanish because of a missing variable.
 *
 * Resolving to a plain `rgb()` costs ~40 lines of well-understood colour maths and buys a
 * gradient that cannot fail to parse anywhere.
 */

/** An OKLCH anchor: `at` is the score it applies to, then lightness, chroma, hue°. */
interface RampStop {
  at: number;
  l: number;
  c: number;
  h: number;
}

/**
 * Picked at near-constant lightness — the scale is a hue journey, not a light-to-dark one —
 * so the near-black label keeps ≥ 6.9:1 contrast at every score and no step falls outside
 * sRGB. The midpoint is the exact amber (`#efd873`) the ribbon used at every score before the
 * ramp existed, so mid-range scores are unchanged.
 */
const RAMP: readonly RampStop[] = [
  { at: 0, l: 0.7, c: 0.172, h: 25 },
  { at: 50, l: 0.8808, c: 0.1242, h: 96.8 },
  { at: 100, l: 0.845, c: 0.135, h: 152 },
];

/** sRGB transfer function (linear → gamma-encoded). */
function encodeSrgb(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/**
 * OKLCH → sRGB, per Björn Ottosson's reference implementation. Clamped rather than
 * gamut-mapped: {@link RAMP} is chosen to stay in gamut, so clamping only ever absorbs
 * floating-point dust at the extremes.
 */
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

/**
 * The ramp colour for `pct`, as an `rgb()` string. Scores outside 0–100 clamp to the end
 * anchors rather than extrapolating off the scale.
 */
export function fitScoreTint(pct: number): string {
  const p = Math.min(100, Math.max(0, pct));
  let i = 0;
  while (i < RAMP.length - 2 && p > (RAMP[i + 1]?.at ?? 0)) {
    i += 1;
  }
  const from = RAMP[i];
  const to = RAMP[i + 1];
  if (from === undefined || to === undefined) {
    return oklchToRgb(RAMP[0]?.l ?? 0, RAMP[0]?.c ?? 0, RAMP[0]?.h ?? 0);
  }
  const t = (p - from.at) / (to.at - from.at);
  // Linear in each OKLCH axis. Hue needs no shortest-arc handling: the anchors run 25° → 97°
  // → 152°, so the direct path is already the short one.
  return oklchToRgb(
    from.l + (to.l - from.l) * t,
    from.c + (to.c - from.c) * t,
    from.h + (to.h - from.h) * t,
  );
}

/**
 * The ribbon's background: the score's tint fading in from a translucent white, so the label
 * sits on plain backdrop and the try-on photo still reads through the left half.
 *
 * The tint is only a tint — the percentage in the text is the gauge. The fade start keeps its
 * design token (with the token's own value inlined as a `var()` fallback, so a host that has
 * not shipped the current stylesheet gets a washed ribbon rather than no ribbon).
 */
export function fitScoreGradient(pct: number): string {
  return `linear-gradient(90deg, var(--sv-color-fit-score-from, rgb(255 255 255 / 0.72)) 0%, ${fitScoreTint(pct)} 100%)`;
}
