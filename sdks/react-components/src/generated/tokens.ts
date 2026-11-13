/**
 * Generated from the studio vaai design tokens (DTCG) — do not edit by hand.
 */

export const SV_COLOR_TOKENS = [
  "--sv-color-bg",
  "--sv-color-surface",
  "--sv-color-surface-elevated",
  "--sv-color-muted",
  "--sv-color-muted-foreground",
  "--sv-color-foreground",
  "--sv-color-foreground-secondary",
  "--sv-color-border",
  "--sv-color-border-strong",
  "--sv-color-grabber",
  "--sv-color-primary",
  "--sv-color-on-primary",
  "--sv-color-recommendation",
  "--sv-color-recommendation-hover",
  "--sv-color-link",
  "--sv-color-link-hover",
  "--sv-color-legal",
  "--sv-color-accent",
  "--sv-color-danger",
  "--sv-color-slide-overlay",
  "--sv-color-overlay",
  "--sv-color-tryon-overlay",
  "--sv-color-image-placeholder",
  "--sv-color-overlay-card",
  "--sv-color-overlay-card-border",
  "--sv-color-fit-score-from",
  "--sv-color-fit-ideal",
  "--sv-color-fit-ideal-foreground",
  "--sv-color-fit-warn",
  "--sv-color-fit-warn-foreground",
  "--sv-color-fit-bad",
  "--sv-color-fit-bad-foreground",
  "--sv-color-fit-unranked",
  "--sv-color-recommendation-surface",
  "--sv-color-recommendation-on-surface",
  "--sv-color-recommendation-ring",
] as const;
export type SvColorToken = (typeof SV_COLOR_TOKENS)[number];

export const SV_FONT_TOKENS = [
  "--sv-font-family-sans",
] as const;
export type SvFontToken = (typeof SV_FONT_TOKENS)[number];

export const SV_RADIUS_TOKENS = [
  "--sv-radius-sheet",
  "--sv-radius-modal",
  "--sv-radius-control",
  "--sv-radius-button-primary",
  "--sv-radius-chip",
] as const;
export type SvRadiusToken = (typeof SV_RADIUS_TOKENS)[number];

export const SV_SPACE_TOKENS = [
  "--sv-space-1",
  "--sv-space-2",
  "--sv-space-3",
  "--sv-space-4",
  "--sv-space-6",
] as const;
export type SvSpaceToken = (typeof SV_SPACE_TOKENS)[number];

export type SvToken = SvColorToken | SvFontToken | SvRadiusToken | SvSpaceToken;

export type SvTokenOverrides = Partial<Record<SvToken, string>>;
