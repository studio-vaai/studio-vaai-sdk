/**
 * The color math behind the tokens: what `color-mix()` does in CSS, in JS. The token spec uses
 * it to compute concrete fallbacks, and tools (the docs' theme builder, contrast checks) use it
 * to show derived values before a shop ships them. Pure functions, no DOM.
 */

type Rgb = readonly [number, number, number];

const HEX = /^#(?<hex>[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse `#rgb` or `#rrggbb`; anything else is `null`. */
export function parseHex(value: string): Rgb | null {
  const hex = HEX.exec(value.trim())?.groups?.["hex"];
  if (hex === globalThis.undefined) {
    return null;
  }
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const channel = (at: number) => Number.parseInt(full.slice(at, at + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
}

export function isHex(value: string): boolean {
  return parseHex(value) !== null;
}

function hexChannel(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");
}

export function toHex([r, g, b]: Rgb): string {
  return `#${hexChannel(r)}${hexChannel(g)}${hexChannel(b)}`;
}

const toLinear = (c: number) => (c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const linear = ([r, g, b]: Rgb): Rgb => [toLinear(r), toLinear(g), toLinear(b)];
const clampToSrgb = (c: number) => fromLinear(Math.min(1, Math.max(0, c)));

function toOklab(rgb: Rgb): Rgb {
  const [r, g, b] = linear(rgb);
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ];
}

function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (L - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (L - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    clampToSrgb(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    clampToSrgb(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    clampToSrgb(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
  ];
}

const lerp = (a: Rgb, b: Rgb, p: number): Rgb => [
  p * a[0] + (1 - p) * b[0],
  p * a[1] + (1 - p) * b[1],
  p * a[2] + (1 - p) * b[2],
];

/** `color-mix(in srgb, a p, b)`, with `p` as a fraction. */
export function mixSrgb(a: string, p: number, b: string): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return ca && cb ? toHex(lerp(ca, cb, p)) : a;
}

/** `color-mix(in oklab, a p, b)`, with `p` as a fraction. */
export function mixOklab(a: string, p: number, b: string): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return ca && cb ? toHex(fromOklab(lerp(toOklab(ca), toOklab(cb), p))) : a;
}

/** `color-mix(in srgb, color p, transparent)`: the color at that opacity. */
export function withAlpha(color: string, p: number): string {
  const rgb = parseHex(color);
  if (!rgb) {
    return color;
  }
  const [r, g, b] = rgb.map((c) => Math.round(c * 255));
  return `rgb(${r} ${g} ${b} / ${Math.round(p * 1000) / 1000})`;
}

function luminance(hex: string): number {
  const [r, g, b] = linear(parseHex(hex) ?? [0, 0, 0]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two opaque colors. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white text on a background, whichever reads better (`contrast-color()` in JS). */
export function readableOn(background: string): string {
  return contrast("#ffffff", background) >= contrast("#0a0a0a", background) ? "#ffffff" : "#0a0a0a";
}
