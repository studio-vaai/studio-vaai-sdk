/** A visible rectangle in an image, expressed as fractions of the full image's dimensions. */
export interface SvImageCrop {
  /** Horizontal center, measured from the left. */
  cx: number;
  /** Vertical center, measured from the top. */
  cy: number;
  width: number;
  height: number;
}

const FULL_IMAGE: Readonly<SvImageCrop> = Object.freeze({ cx: 0.5, cy: 0.5, width: 1, height: 1 });

/** Invalid or out-of-bounds input falls back to the full image, never invalid CSS. */
export function imageCrop(crop: SvImageCrop | undefined): Readonly<SvImageCrop> {
  if (
    !crop ||
    ![crop.cx, crop.cy, crop.width, crop.height].every((value) => Number.isFinite(value)) ||
    crop.width < Number.EPSILON ||
    crop.height < Number.EPSILON ||
    crop.cx - crop.width / 2 < -Number.EPSILON ||
    crop.cy - crop.height / 2 < -Number.EPSILON ||
    crop.cx + crop.width / 2 > 1 + Number.EPSILON ||
    crop.cy + crop.height / 2 > 1 + Number.EPSILON
  ) {
    return FULL_IMAGE;
  }
  return crop;
}
