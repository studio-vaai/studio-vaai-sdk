// @vitest-environment jsdom

/* oxlint-disable unicorn/numeric-separators-style -- standard sRGB transfer-function
   constants; grouping their digits obscures values every colour reference prints as-is. */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FitScorePanelDefault } from "../src/ui/fit-score-panel.js";
import { fitScoreGradient, fitScoreTint } from "../src/ui/fit-score-ramp.js";

/** `rgb(r g b)` → channels, so tests can talk about hue and lightness rather than strings. */
function channels(rgb: string): [number, number, number] {
  const parsed = /rgb\((\d+) (\d+) (\d+)\)/.exec(rgb);
  if (parsed === null) {
    throw new Error(`not an rgb() string: ${rgb}`);
  }
  return [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
}

/** WCAG relative luminance, for the contrast floor the label depends on. */
function luminance(rgb: string): number {
  const linear = channels(rgb).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

describe("fit score ramp", () => {
  it("hits its three anchors: red, the legacy amber, green", () => {
    expect(fitScoreTint(0)).toBe("rgb(247 108 102)");
    // The midpoint must stay the amber the ribbon used before the ramp existed, so
    // mid-range scores did not shift when the scale was introduced.
    expect(fitScoreTint(50)).toBe("rgb(239 216 115)");
    expect(fitScoreTint(100)).toBe("rgb(131 229 160)");
  });

  it("moves continuously — neighbouring scores differ, but never by a visible jump", () => {
    let previous = fitScoreTint(0);
    for (let pct = 1; pct <= 100; pct += 1) {
      const current = fitScoreTint(pct);
      expect(current).not.toBe(previous);
      const [pr, pg, pb] = channels(previous);
      const [cr, cg, cb] = channels(current);
      // A bucketed scale would jump ~80 in a channel at each boundary; interpolation keeps
      // every step small, which is the whole point of not using three fixed swatches.
      expect(Math.max(Math.abs(cr - pr), Math.abs(cg - pg), Math.abs(cb - pb))).toBeLessThan(8);
      previous = current;
    }
  });

  it("runs red → green: the red channel falls and the green channel rises across the scale", () => {
    const [lowR, lowG] = channels(fitScoreTint(0));
    const [highR, highG] = channels(fitScoreTint(100));
    expect(highR).toBeLessThan(lowR);
    expect(highG).toBeGreaterThan(lowG);
  });

  it("keeps the near-black label legible at every score", () => {
    // `--sv-color-foreground` is #09090b.
    const foreground = luminance("rgb(9 9 11)");
    for (let pct = 0; pct <= 100; pct += 1) {
      const contrast = (luminance(fitScoreTint(pct)) + 0.05) / (foreground + 0.05);
      expect(contrast).toBeGreaterThan(6.5);
    }
  });

  it("clamps out-of-range scores instead of extrapolating off the scale", () => {
    expect(fitScoreTint(-40)).toBe(fitScoreTint(0));
    expect(fitScoreTint(140)).toBe(fitScoreTint(100));
  });

  it("fades the tint in from the translucent-white token, with a literal fallback", () => {
    const gradient = fitScoreGradient(93);
    expect(gradient).toContain("var(--sv-color-fit-score-from, rgb(255 255 255 / 0.72))");
    expect(gradient).toContain(fitScoreTint(93));
    // No `color-mix()` / gradient interpolation keywords: an unparseable value takes the
    // whole declaration down and renders the ribbon blank white.
    expect(gradient).not.toContain("color-mix");
    expect(gradient).not.toContain("oklab");
  });

  it("paints the ribbon with the gradient for its score", () => {
    const { container } = render(
      <FitScorePanelDefault
        label="Fit score"
        pct={93}
        open={false}
        onOpenChange={vi.fn<(open: boolean) => void>()}
        toggleSrLabel="toggle"
      />,
    );
    const ribbon = container.querySelector<HTMLElement>('[data-studio-vaai="try-on-fit-score"]');
    expect(ribbon?.style.backgroundImage).toBe(fitScoreGradient(93));
  });
});
