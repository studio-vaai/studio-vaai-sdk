import { describe, expect, it } from "vitest";

import {
  backdropImageFraming,
  photoImageFraming,
  resolveImageFraming,
} from "../src/media/image-framing.js";

describe("shared image framing", () => {
  it("covers the entire backdrop without stretching and preserves the review gutter", () => {
    for (const aspect of [0.5, 0.75, 2]) {
      const viewport = { width: 370, height: 594 };
      const result = resolveImageFraming(viewport, aspect, aspect, backdropImageFraming())!;
      expect(result.frame).toEqual({ x: 0, y: 0, ...viewport });
      expect(result.x).toBeLessThanOrEqual(0);
      expect(result.y).toBeLessThanOrEqual(0);
      expect(result.x + result.width).toBeGreaterThanOrEqual(viewport.width - 1e-7);
      expect(result.y + result.height).toBeGreaterThanOrEqual(viewport.height - 1e-7);
      expect(result.width / result.height).toBeCloseTo(aspect);
    }
    const framing = photoImageFraming({ aspectRatio: 0.75 })!;
    const review = resolveImageFraming({ width: 370, height: 514 }, 0.75, 0.75, framing)!;
    expect(review.frame.x).toBeCloseTo(0);
    expect(review.frame.width).toBeCloseTo(370);
  });
  it("protects off-center bounds and keeps every pane edge image-covered across viewport shapes", () => {
    for (const width of [160, 360, 700, 1040]) {
      for (const height of [128, 260, 540, 900]) {
        for (const cx of [0.2, 0.5, 0.8]) {
          const bounds = { cx, cy: 0.5, width: 0.35, height: 0.85 };
          const result = resolveImageFraming({ width, height }, 0.75, 0.75, { bounds })!;
          const eps = 1e-7;
          expect(result.x + (cx - bounds.width / 2) * result.width).toBeGreaterThanOrEqual(
            width * 0.05 - eps,
          );
          expect(result.x + (cx + bounds.width / 2) * result.width).toBeLessThanOrEqual(
            width * 0.95 + eps,
          );
          expect(result.y + 0.075 * result.height).toBeGreaterThanOrEqual(height * 0.05 - eps);
          expect(result.y + 0.925 * result.height).toBeLessThanOrEqual(height * 0.95 + eps);
          expect(result.frame.x).toBeGreaterThanOrEqual(result.x - eps);
          expect(result.frame.y).toBeGreaterThanOrEqual(result.y - eps);
          expect(result.frame.x + result.frame.width).toBeLessThanOrEqual(
            result.x + result.width + eps,
          );
          expect(result.frame.y + result.frame.height).toBeLessThanOrEqual(
            result.y + result.height + eps,
          );
          expect(result.width / result.height).toBeCloseTo(0.75);
        }
      }
    }
  });

  it("leaves unavailable source margins outside the rounded pane", () => {
    const result = resolveImageFraming({ width: 370, height: 500 }, 1022 / 1169, 1022 / 1169, {
      bounds: { cx: 498.5 / 1022, cy: 647 / 1169, width: 405 / 1022, height: 1044 / 1169 },
    })!;
    expect(result.y + result.height).toBeLessThan(500);
    expect(result.frame.y + result.frame.height).toBeCloseTo(result.y + result.height);
  });

  it("contains the complete source without metadata, including mismatched aspect ratios", () => {
    for (const aspect of [0.5, 0.875, 1.5, 3]) {
      const result = resolveImageFraming({ width: 370, height: 500 }, aspect, 0.75, {})!;
      expect(result.frame.x).toBeCloseTo(result.x);
      expect(result.frame.y).toBeCloseTo(result.y);
      expect(result.frame.width).toBeCloseTo(result.width);
      expect(result.frame.height).toBeCloseTo(result.height);
      expect(result.width / result.height).toBeCloseTo(aspect);
    }
  });

  it("aligns the shared canvas with the stage foot without changing its scale", () => {
    const viewport = { width: 320, height: 640 };
    const original = resolveImageFraming(viewport, 0.75, 0.75, {})!;
    const aligned = resolveImageFraming(viewport, 0.75, 0.75, { blockAlign: "end" })!;
    const wide = resolveImageFraming(viewport, 1.5, 0.75, { blockAlign: "end" })!;
    expect(aligned.height).toBeCloseTo(original.height);
    expect(aligned.frame.y + aligned.frame.height).toBeCloseTo(viewport.height);
    expect(wide.y + wide.height / 2).toBeCloseTo(aligned.y + aligned.height / 2);
  });

  it("uses conservative defaults for invalid bounds and margins and refuses invalid dimensions", () => {
    const viewport = { width: 370, height: 500 };
    const baseline = resolveImageFraming(viewport, 0.75, 0.75, {});
    expect(
      resolveImageFraming(viewport, 0.75, 0.75, {
        bounds: { cx: 0.5, cy: 0.5, width: -1, height: 1 },
        margin: Number.NaN,
      }),
    ).toEqual(baseline);
    expect(resolveImageFraming({ width: 0, height: 500 }, 0.75, 0.75, {})).toBeUndefined();
    expect(resolveImageFraming(viewport, Number.NaN, 0.75, {})).toBeUndefined();
  });
});
