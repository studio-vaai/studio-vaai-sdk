/** Pixel rect of a camera frame, in the frame's own coordinates. */
export interface CaptureCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of a camera frame the live preview shows: the largest centred rect of `aspectRatio`
 * (`width / height`), which is what the preview's cover-fit leaves visible. The captured photo is
 * cut to this rect, so the photo that is uploaded is the one the shopper composed.
 *
 * An unusable ratio keeps the whole frame.
 */
export function previewCropRect(
  frame: { width: number; height: number },
  aspectRatio: number | null,
): CaptureCropRect {
  const whole = { x: 0, y: 0, width: frame.width, height: frame.height };
  if (aspectRatio === null || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return whole;
  }
  const frameAspect = frame.width / frame.height;
  if (frameAspect > aspectRatio) {
    const width = Math.min(frame.width, Math.round(frame.height * aspectRatio));
    return { x: Math.floor((frame.width - width) / 2), y: 0, width, height: frame.height };
  }
  const height = Math.min(frame.height, Math.round(frame.width / aspectRatio));
  return { x: 0, y: Math.floor((frame.height - height) / 2), width: frame.width, height };
}
