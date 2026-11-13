import { describe, expect, it } from "vitest";

import { mixSrgb } from "../src/internal/theme/color.js";
import {
  contrast,
  deriveSvColors,
  readableOn,
  svAppearanceDefaults,
  svDerivedFormula,
  SV_DERIVED_DEFAULTS,
} from "../src/internal/theme/index.js";

describe("token spec", () => {
  it("meets AA for secondary text and focus on every default surface", () => {
    for (const appearance of ["light", "dark"] as const) {
      const { seeds, steps } = svAppearanceDefaults(appearance);
      const colors = deriveSvColors(seeds, steps);
      for (const surface of [
        seeds.background,
        colors["surface-raised"],
        colors.control,
        colors.muted,
      ]) {
        expect(contrast(colors["muted-foreground"], surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.ring, surface)).toBeGreaterThanOrEqual(3);
      }
      for (const photo of ["#000000", "#ffffff"]) {
        const overlay = mixSrgb(seeds.background, steps["opacity-photo-overlay"] / 100, photo);
        expect(contrast(colors["photo-overlay-foreground"], overlay)).toBeGreaterThanOrEqual(4.5);
        const glass = mixSrgb(seeds.background, steps["opacity-glass"] / 100, photo);
        expect(contrast(seeds.foreground, glass)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("derives today's grays from the zinc ink, with a black primary", () => {
    expect(SV_DERIVED_DEFAULTS).toMatchObject({
      muted: "#f5f5f6",
      "muted-foreground": "#626263",
      border: "#e5e5e6",
      input: "#e5e5e6",
      ring: "#848485",
      accent: "#f5f5f6",
      "primary-hover": "#191919",
      glass: "rgb(255 255 255 / 0.72)",
    });
  });

  it("keeps dark text, inputs and focus rings readable across surface levels", () => {
    const { seeds, steps } = svAppearanceDefaults("dark");
    const colors = deriveSvColors(seeds, steps);
    expect(contrast(seeds.foreground, seeds.background)).toBeGreaterThanOrEqual(12);
    expect(contrast(colors["muted-foreground"], colors.muted)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(seeds["primary-foreground"], seeds.primary)).toBeGreaterThanOrEqual(7);
    expect(contrast(colors.input, seeds.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.ring, colors.muted)).toBeGreaterThanOrEqual(3);
  });

  it("keeps status text readable on its own tint", () => {
    for (const appearance of ["light", "dark"] as const) {
      const { seeds, steps } = svAppearanceDefaults(appearance);
      const colors = deriveSvColors(seeds, steps);
      for (const status of ["positive", "caution", "destructive"] as const) {
        expect(
          contrast(colors[`${status}-foreground`], colors[`${status}-muted`]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("separates dark raised surfaces and controls while retaining light-filled selections", () => {
    const { seeds, steps } = svAppearanceDefaults("dark");
    const colors = deriveSvColors(seeds, steps);
    expect(colors["surface-raised"]).toBe("#202022");
    expect(colors.control).toBe("#2b2b2d");
    expect(colors["control-selected"]).toBe("#e4e4e7");
    expect(contrast(colors.control, seeds.background)).toBeGreaterThan(
      contrast(colors["surface-raised"], seeds.background),
    );
    expect(
      contrast(colors["control-selected-foreground"], colors["control-selected"]),
    ).toBeGreaterThanOrEqual(7);
  });

  it("keeps dark text readable on surfaces and photo overlays over both extremes", () => {
    const { seeds, steps } = svAppearanceDefaults("dark");
    const colors = deriveSvColors(seeds, steps);
    for (const surface of [colors["surface-raised"], colors.control]) {
      expect(contrast(seeds.foreground, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors["muted-foreground"], surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const photo of ["#000000", "#ffffff"]) {
      const composite = mixSrgb(seeds.background, steps["opacity-photo-overlay"] / 100, photo);
      expect(contrast(colors["photo-overlay-foreground"], composite)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors["muted-foreground"], composite)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("derives the semantic layers from caller seeds rather than a fixed palette", () => {
    const { seeds, steps } = svAppearanceDefaults("dark");
    const colors = deriveSvColors({ ...seeds, background: "#221b18", primary: "#efc59c" }, steps);
    expect(colors["surface-raised"]).not.toBe("#202022");
    expect(colors.control).not.toBe("#2b2b2d");
    expect(colors["control-selected"]).toBe("#efc59c");
    expect(colors["photo-overlay"]).toBe("rgb(34 27 24 / 0.96)");
  });

  it("writes the CSS formula from the same spec", () => {
    expect(svDerivedFormula("muted")).toBe(
      "color-mix(in srgb, var(--_sv-foreground) var(--_sv-mix-muted), var(--_sv-background))",
    );
    expect(svDerivedFormula("positive-muted")).toBe(
      "color-mix(in oklab, var(--_sv-positive) 16%, var(--_sv-background))",
    );
    expect(svDerivedFormula("glass")).toBe(
      "color-mix(in srgb, var(--_sv-background) var(--_sv-opacity-glass), transparent)",
    );
    expect(svDerivedFormula("accent")).toBe("var(--_sv-muted)");
  });
});

describe("readableOn", () => {
  it("picks white on dark and ink on light backgrounds", () => {
    expect(readableOn("#171717")).toBe("#ffffff");
    expect(readableOn("#f5c400")).toBe("#0a0a0a");
  });
});
