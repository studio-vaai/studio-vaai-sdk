import { describe, expect, it } from "vitest";

import { previewCropRect } from "../src/batteries/capture-crop.js";

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
