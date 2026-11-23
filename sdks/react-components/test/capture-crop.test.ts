import { describe, expect, it } from "vitest";

import { previewAspectRatioForCamera, previewCropRect } from "../src/batteries/capture-crop.js";

describe("previewCropRect", () => {
  it("keeps the centred portrait cut of a laptop camera's landscape frame", () => {
    expect(previewCropRect({ width: 1920, height: 1080 }, 3 / 4)).toEqual({
      x: 555,
      y: 0,
      width: 810,
      height: 1080,
    });
  });

  it("trims the top and bottom of a frame taller than the preview", () => {
    expect(previewCropRect({ width: 720, height: 1280 }, 3 / 4)).toEqual({
      x: 0,
      y: 160,
      width: 720,
      height: 960,
    });
  });

  it("keeps a frame that already has the preview's shape whole", () => {
    expect(previewCropRect({ width: 960, height: 1280 }, 3 / 4)).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 1280,
    });
  });

  it("never reaches outside the frame", () => {
    for (const frame of [
      { width: 1281, height: 721 },
      { width: 641, height: 479 },
      { width: 3, height: 5 },
    ]) {
      const crop = previewCropRect(frame, 3 / 4);
      expect(crop.x + crop.width).toBeLessThanOrEqual(frame.width);
      expect(crop.y + crop.height).toBeLessThanOrEqual(frame.height);
      expect(crop.width).toBeGreaterThan(0);
      expect(crop.height).toBeGreaterThan(0);
    }
  });

  it("keeps the whole frame when the preview's shape is unknown", () => {
    const whole = { x: 0, y: 0, width: 1280, height: 720 };
    expect(previewCropRect({ width: 1280, height: 720 }, null)).toEqual(whole);
    expect(previewCropRect({ width: 1280, height: 720 }, 0)).toEqual(whole);
    expect(previewCropRect({ width: 1280, height: 720 }, Number.NaN)).toEqual(whole);
  });
});

describe("previewAspectRatioForCamera", () => {
  it("keeps the baseline for a landscape camera", () => {
    expect(previewAspectRatioForCamera({ width: 1920, height: 1080 }, 3 / 4)).toBe(3 / 4);
  });

  it("takes an upright camera's own shape, so none of its frame is cut", () => {
    const aspect = previewAspectRatioForCamera({ width: 1080, height: 1920 }, 3 / 4);
    expect(aspect).toBe(9 / 16);
    expect(previewCropRect({ width: 1080, height: 1920 }, aspect)).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920,
    });
  });

  it("does not go narrower than 9:16", () => {
    expect(previewAspectRatioForCamera({ width: 720, height: 1600 }, 3 / 4)).toBe(9 / 16);
  });

  it("keeps the baseline until the camera has delivered a frame", () => {
    expect(previewAspectRatioForCamera(null, 3 / 4)).toBe(3 / 4);
    expect(previewAspectRatioForCamera({ width: 0, height: 0 }, 3 / 4)).toBe(3 / 4);
  });
});
