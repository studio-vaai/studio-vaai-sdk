import { css, unsafeCSS } from "lit";

import {
  svDerivedFormula,
  deriveSvColors,
  svAppearanceDefaults,
  SV_DARK_APPEARANCE,
  SV_COLOR_SEEDS,
  SV_DERIVED_COLOR_NAMES,
  SV_DERIVED_DEFAULTS,
  SV_FIXED_COLORS,
  SV_FONT_WEIGHTS,
  SV_MIX_STEPS,
  SV_MOTION,
  SV_RADII,
  SV_SHADOWS,
  SV_TEXT_SIZES,
} from "../internal/theme/tokens.js";

/**
 * The CSS every element adopts, generated from the token data in `internal/theme/tokens.ts`: resolves
 * the private `--_sv-*` tokens on the element's `:host`. Derived colors get their concrete
 * default first and the `color-mix()` formula only behind `@supports`, so a browser that cannot
 * parse the formula keeps the default instead of a blank declaration.
 */

function declarations(entries: Iterable<[string, string]>): string {
  return Array.from(entries, ([name, value]) => `  ${name}: ${value};`).join("\n");
}

/** A private token that a shop can override through its public name. */
function resolved(name: string, fallback: string): [string, string] {
  return [`--_sv-${name}`, `var(--sv-${name}, ${fallback})`];
}

/** A private token with no public name: not part of the theming surface. */
function internal(name: string, value: string): [string, string] {
  return [`--_sv-${name}`, value];
}

const hostDeclarations = declarations([
  ...Object.entries(SV_COLOR_SEEDS).map(([n, v]) => resolved(n, v)),
  ...Object.entries(SV_MIX_STEPS).map(([n, v]) => resolved(n, `${v}%`)),
  ...SV_DERIVED_COLOR_NAMES.map((n) => resolved(n, SV_DERIVED_DEFAULTS[n])),
  ...Object.entries(SV_FIXED_COLORS).map(([n, v]) => resolved(n, v)),
  resolved("root", "1rem"),
  resolved("density", "1"),
  // Tailwind's spacing unit at density 1 (root × 0.25), scaled by density.
  internal("spacing", "calc(var(--_sv-root) * 0.25 * var(--_sv-density))"),
  resolved("radius", "calc(var(--_sv-root) * 0.5)"),
  ...Object.entries(SV_RADII).map(([n, f]) =>
    internal(`radius-${n}`, `calc(var(--_sv-radius) * ${f})`),
  ),
  internal("radius-full", "9999px"),
  internal("field-padding-inline", "calc(var(--_sv-spacing) * 4)"),
  // A button: its label's line height plus spacing × 3 above and below (48px by default).
  internal(
    "button-height",
    "calc(var(--_sv-text-base) * var(--_sv-text-base--line-height) + var(--_sv-spacing) * 6)",
  ),
  ...Object.entries(SV_TEXT_SIZES).flatMap(([n, { size, lineHeight }]) => [
    internal(`text-${n}`, `calc(var(--_sv-root) * ${size})`),
    internal(`text-${n}--line-height`, `calc(${lineHeight} / ${size})`),
  ]),
  ...Object.entries(SV_FONT_WEIGHTS).map(([n, v]) => internal(`font-weight-${n}`, String(v))),
  ...Object.entries(SV_SHADOWS).map(([n, v]) => internal(`shadow-${n}`, v)),
  ...Object.entries(SV_MOTION).map(([n, v]) => internal(n, v)),
]);

const derivedDeclarations = declarations(
  SV_DERIVED_COLOR_NAMES.map((n) => [`--_sv-${n}`, `var(--sv-${n}, ${svDerivedFormula(n)})`]),
);

const darkAppearance = svAppearanceDefaults("dark");
const darkDerivedDefaults = deriveSvColors(darkAppearance.seeds, darkAppearance.steps);
const darkDefaults = declarations([
  ...Object.entries(SV_DARK_APPEARANCE.seeds).map(([name, value]) => resolved(name, value)),
  ...Object.entries(SV_DARK_APPEARANCE.steps).map(([name, value]) => resolved(name, `${value}%`)),
  ...Object.entries(SV_DARK_APPEARANCE.fixed).map(([name, value]) => resolved(name, value)),
  ...SV_DERIVED_COLOR_NAMES.map((name) => resolved(name, darkDerivedDefaults[name])),
]);

/** Adopt in every element. */
export const svTokens = css`
  :host {
    color-scheme: light;
    ${unsafeCSS(hostDeclarations)}
  }

  :host([data-sv-appearance="dark"]) {
    color-scheme: dark;
    ${unsafeCSS(darkDefaults)}
  }

  @supports (color: color-mix(in srgb, red, red)) {
    :host,
    :host([data-sv-appearance="dark"]) {
      ${unsafeCSS(derivedDeclarations)}
    }
  }
`;
