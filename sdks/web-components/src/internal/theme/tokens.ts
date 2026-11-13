import { typedFromEntries, typedKeys } from "../typed.js";
import { mixOklab, mixSrgb, withAlpha } from "./color.js";

/**
 * The sv design tokens as data: the one source for the CSS every element adopts
 * (`styles/tokens.ts`), for the concrete fallbacks, and for tools such as the docs' theme
 * builder. No Lit, no DOM.
 *
 * Two layers of custom properties:
 *
 * - **Public `--sv-*`** — what a shop sets, on `sv-*` elements or any ancestor. Elements never
 *   set these themselves (a value on an inner element's `:host` would shadow the shop's
 *   inherited value). `SV_PUBLIC_TOKENS` lists all of them.
 * - **Private `--_sv-*`** — what component CSS reads. Most resolve a public token with its
 *   default as fallback. Some have no public name (the radius steps, text sizes, weights,
 *   shadows and motion): they follow `--sv-root` and `--sv-radius` but are not set directly.
 *
 * Colors: seven seeds; every other color is a mix described once in `SV_DERIVED_COLORS`. From
 * that spec come both the CSS `color-mix()` formula and, through the JS in `color.ts`, the
 * concrete fallback for browsers without `color-mix()`. The defaults are shadcn's Neutral theme.
 *
 * Sizes are multiples of `--sv-root` (the visitor's text size, never the shop's `rem`). Until
 * `sv-try-on` registers it, the fallback is `1rem`.
 */

/**
 * Seeds a shop sets to brand the flow. The defaults are today's try-on (the React SDK's tokens):
 * zinc ink, a black-on-white primary, and its fit and error colors.
 */
export const SV_COLOR_SEEDS = {
  background: "#ffffff",
  foreground: "#09090b",
  primary: "#000000",
  "primary-foreground": "#ffffff",
  positive: "#22c55e",
  caution: "#f59e0b",
  destructive: "#dc2626",
} as const;

export type SvColorSeed = keyof typeof SV_COLOR_SEEDS;
export type SvColorSeeds = Record<SvColorSeed, string>;

/** Neutral surface mixes and overlay opacity, expressed as percentages. */
export const SV_MIX_STEPS = {
  "mix-muted": 3.88,
  "mix-border": 10.41,
  "mix-input": 10.41,
  "mix-ring": 50,
  "mix-muted-foreground": 64,
  "mix-surface-raised": 3.88,
  "mix-control": 0,
  "mix-control-hover": 3.88,
  "opacity-glass": 72,
  "opacity-photo-overlay": 85,
  "opacity-overlay-border": 6,
} as const;

type SvMixStep = keyof typeof SV_MIX_STEPS;
export type SvMixSteps = Record<SvMixStep, number>;

/** One derived color: `from` mixed `amount` percent into `into`, in `space`. */
interface SvMix {
  readonly space: "srgb" | "oklab";
  readonly from: SvColorSeed;
  /** A fixed percent, or a shared mix step. */
  readonly amount: number | SvMixStep;
  readonly into: SvColorSeed | "transparent";
}

/** A semantic color that follows a seed or an existing derived color. */
interface SvAlias {
  readonly same: "muted" | SvColorSeed;
}

type SvDerivedSpec = SvMix | SvAlias;

const ink = (amount: SvMixStep): SvMix => ({
  space: "srgb",
  from: "foreground",
  amount,
  into: "background",
});
const statusMuted = (from: SvColorSeed): SvMix => ({
  space: "oklab",
  from,
  amount: 16,
  into: "background",
});
const statusForeground = (from: SvColorSeed): SvMix => ({
  space: "oklab",
  from,
  amount: 60,
  into: "foreground",
});

/** Colors derived from the seeds; each can still be overridden through its public name. */
const SV_DERIVED_COLORS = {
  "surface-raised": ink("mix-surface-raised"),
  control: ink("mix-control"),
  "control-hover": ink("mix-control-hover"),
  "control-selected": { same: "primary" },
  "control-selected-foreground": { same: "primary-foreground" },
  muted: ink("mix-muted"),
  "muted-foreground": ink("mix-muted-foreground"),
  border: ink("mix-border"),
  input: ink("mix-input"),
  ring: ink("mix-ring"),
  accent: { same: "muted" },
  "primary-hover": { space: "srgb", from: "primary", amount: 90, into: "background" },
  "positive-muted": statusMuted("positive"),
  "positive-foreground": statusForeground("positive"),
  "caution-muted": statusMuted("caution"),
  "caution-foreground": statusForeground("caution"),
  "destructive-muted": statusMuted("destructive"),
  "destructive-foreground": statusForeground("destructive"),
  glass: { space: "srgb", from: "background", amount: "opacity-glass", into: "transparent" },
  "photo-overlay": {
    space: "srgb",
    from: "background",
    amount: "opacity-photo-overlay",
    into: "transparent",
  },
  "photo-overlay-foreground": { same: "foreground" },
  "glass-border": {
    space: "srgb",
    from: "foreground",
    amount: "opacity-overlay-border",
    into: "transparent",
  },
  scrim: { space: "srgb", from: "background", amount: 60, into: "transparent" },
} as const satisfies Record<string, SvDerivedSpec>;

export type SvDerivedColor = keyof typeof SV_DERIVED_COLORS;

/** Colors that are not derived from anything. */
export const SV_FIXED_COLORS = {
  "media-background": "#000000",
  "media-foreground": "#ffffff",
  "media-overlay": "rgb(0 0 0 / 0.6)",
  "media-overlay-hover": "rgb(0 0 0 / 0.75)",
  "media-control": "rgb(255 255 255 / 0.15)",
  backdrop: "rgb(0 0 0 / 0.45)",
  "shimmer-start": "rgb(192 132 252 / 0.5)",
  "shimmer-end": "rgb(96 165 250 / 0.5)",
  annotation: "#0000fe",
} as const;

export type SvFixedColor = keyof typeof SV_FIXED_COLORS;

/**
 * Public size tokens with their defaults, as written in the CSS. Two inputs set every size:
 * `root`, the text size (the visitor's, once `sv-try-on` registers it), and `density`, a plain
 * number that scales all padding and gaps (1 is the default, 0.9 tighter, 1.1 roomier). Control
 * heights follow from both: a button is its label's line height plus padding, so it grows with
 * the text and with density, and no height is set on its own. `density` is unitless on purpose:
 * a value that pointed at another unset variable would be invalid, and silently ignored.
 */
const SV_SIZE_TOKENS = {
  root: "1rem",
  density: "1",
  radius: "calc(var(--sv-root) * 0.5)",
} as const;

/**
 * Today's try-on font: Inter, else the system UI font. The SDK does not load it; a shop that
 * has Inter (either Fontsource name) gets it, others get their system font. A shop that wants
 * its own font names it: `--sv-font-sans: "Shop Sans", sans-serif`.
 */
export const SV_FONT_SANS =
  '"Inter", "Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Public font tokens. */
const SV_FONT_TOKENS = {
  "font-sans": SV_FONT_SANS,
} as const;

/** Tailwind's ladder: size and line height as multiples of the root. */
export const SV_TEXT_SIZES = {
  xs: { size: 0.75, lineHeight: 1 },
  sm: { size: 0.875, lineHeight: 1.25 },
  base: { size: 1, lineHeight: 1.5 },
  "2xl": { size: 1.5, lineHeight: 2 },
  "4xl": { size: 2.25, lineHeight: 2.5 },
} as const;

export const SV_FONT_WEIGHTS = { light: 300, normal: 400, medium: 500, semibold: 600 } as const;

/**
 * Radius scale as factors of `--sv-radius` (8px by default): `md` buttons and cards (8), `lg`
 * photos and the stage (12), `xl` dialogs and the drawer (16). `full` is a fixed pill.
 */
export const SV_RADII = { sm: 0.5, md: 1, lg: 1.5, xl: 2 } as const;

export const SV_SHADOWS = {
  sm: "0 1px 2px rgb(10 10 10 / 0.08)",
  md: "0 4px 16px rgb(10 10 10 / 0.1)",
  lg: "0 8px 32px rgb(10 10 10 / 0.18)",
} as const;

export const SV_MOTION = {
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  "duration-fast": "150ms",
  duration: "250ms",
  "duration-slow": "400ms",
} as const;

/**
 * Charcoal surfaces, soft white text and brighter semantic colors for dark appearance.
 * Surface, border and input steps stay distinct; focus rings remain visible on raised cards.
 */
export const SV_DARK_APPEARANCE = {
  seeds: {
    background: "#151517",
    foreground: "#f4f4f5",
    primary: "#e4e4e7",
    "primary-foreground": "#18181b",
    positive: "#4ade80",
    caution: "#fbbf24",
    destructive: "#f87171",
  },
  steps: {
    "mix-surface-raised": 5,
    "mix-control": 10,
    "mix-control-hover": 14,
    "opacity-glass": 94,
    "opacity-photo-overlay": 96,
    "opacity-overlay-border": 10,
    "mix-muted": 14,
    "mix-border": 20,
    "mix-input": 40,
    "mix-ring": 60,
    "mix-muted-foreground": 70,
  },
  fixed: { backdrop: "rgb(0 0 0 / 0.7)", annotation: "#a5b4fc" },
} as const satisfies {
  seeds: Partial<SvColorSeeds>;
  steps: Partial<SvMixSteps>;
  fixed: Partial<Record<SvFixedColor, string>>;
};

export type SvAppearance = "light" | "dark";

/** The complete seeds and steps of an appearance. */
export function svAppearanceDefaults(appearance: SvAppearance): {
  seeds: SvColorSeeds;
  steps: SvMixSteps;
} {
  return appearance === "dark"
    ? {
        seeds: { ...SV_COLOR_SEEDS, ...SV_DARK_APPEARANCE.seeds },
        steps: { ...SV_MIX_STEPS, ...SV_DARK_APPEARANCE.steps },
      }
    : { seeds: { ...SV_COLOR_SEEDS }, steps: { ...SV_MIX_STEPS } };
}

/** Every public token name, without the `--sv-` prefix. Nothing else is part of the theming API. */
export type SvTokenName =
  | SvColorSeed
  | SvMixStep
  | SvDerivedColor
  | SvFixedColor
  | keyof typeof SV_SIZE_TOKENS
  | keyof typeof SV_FONT_TOKENS;

/** Token names in order, typed, for iterating the groups above. */
export const SV_COLOR_SEED_NAMES: readonly SvColorSeed[] = typedKeys(SV_COLOR_SEEDS);
const SV_MIX_STEP_NAMES: readonly SvMixStep[] = typedKeys(SV_MIX_STEPS);
export const SV_DERIVED_COLOR_NAMES: readonly SvDerivedColor[] = typedKeys(SV_DERIVED_COLORS);
const SV_FIXED_COLOR_NAMES: readonly SvFixedColor[] = typedKeys(SV_FIXED_COLORS);

/** Every public token at runtime, for docs, tools and tests. */
export const SV_PUBLIC_TOKENS: readonly SvTokenName[] = [
  ...SV_COLOR_SEED_NAMES,
  ...SV_MIX_STEP_NAMES,
  ...SV_DERIVED_COLOR_NAMES,
  ...SV_FIXED_COLOR_NAMES,
  ...typedKeys(SV_SIZE_TOKENS),
  ...typedKeys(SV_FONT_TOKENS),
];

/** A map of public custom properties, e.g. for an inline `style`. */
export type SvTokenStyle = Partial<Record<`--sv-${SvTokenName}`, string>>;

/** The public custom properties that put an element subtree into an appearance. */
export function svAppearanceStyle(appearance: SvAppearance): SvTokenStyle {
  if (appearance === "light") {
    return {};
  }
  return Object.fromEntries(
    [
      ...Object.entries(SV_DARK_APPEARANCE.seeds),
      ...Object.entries(SV_DARK_APPEARANCE.steps).map(([name, pct]) => [name, `${pct}%`]),
      ...Object.entries(SV_DARK_APPEARANCE.fixed),
    ].map(([name, value]) => [`--sv-${name}`, value]),
  );
}

/**
 * The `color-mix()` formula of a derived color over the private tokens, for the CSS.
 */
export function svDerivedFormula(name: SvDerivedColor): string {
  const spec: SvDerivedSpec = SV_DERIVED_COLORS[name];
  if ("same" in spec) {
    return `var(--_sv-${spec.same})`;
  }
  const amount = typeof spec.amount === "number" ? `${spec.amount}%` : `var(--_sv-${spec.amount})`;
  const into = spec.into === "transparent" ? "transparent" : `var(--_sv-${spec.into})`;
  return `color-mix(in ${spec.space}, var(--_sv-${spec.from}) ${amount}, ${into})`;
}

/**
 * Every derived color for given seeds and steps, computed the way the CSS formula does.
 * Opaque colors come back as `#rrggbb`, mixes with `transparent` as `rgb(r g b / a)`.
 */
export function deriveSvColors(
  seeds: SvColorSeeds,
  steps: SvMixSteps,
): Record<SvDerivedColor, string> {
  const mixed = (spec: SvMix): string => {
    const p = (typeof spec.amount === "number" ? spec.amount : steps[spec.amount]) / 100;
    const from = seeds[spec.from];
    if (spec.into === "transparent") {
      return withAlpha(from, p);
    }
    return (spec.space === "srgb" ? mixSrgb : mixOklab)(from, p, seeds[spec.into]);
  };
  const resolve = (name: SvDerivedColor): string => {
    const spec: SvDerivedSpec = SV_DERIVED_COLORS[name];
    if ("same" in spec) {
      return spec.same === "muted" ? resolve("muted") : seeds[spec.same];
    }
    return mixed(spec);
  };
  return typedFromEntries(SV_DERIVED_COLOR_NAMES.map((name) => [name, resolve(name)]));
}

/** The derived colors of the default (light) seeds: the CSS fallbacks. */
export const SV_DERIVED_DEFAULTS: Record<SvDerivedColor, string> = deriveSvColors(
  SV_COLOR_SEEDS,
  SV_MIX_STEPS,
);
