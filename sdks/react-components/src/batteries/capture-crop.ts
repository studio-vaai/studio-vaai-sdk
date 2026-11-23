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

/** The narrowest preview frame, `width / height`: a phone camera's 9:16. */
const NARROWEST_PREVIEW_ASPECT_RATIO = 9 / 16;

/**
 * Shape of the live preview frame for a camera delivering `camera`-sized frames.
 *
 * A camera whose frame is narrower than the baseline — a phone held upright, a webcam turned on
 * its side — already frames a standing person, so the preview takes the camera's own shape and
 * shows all of it. Cutting it to the baseline threw away the top and bottom of the frame, which
 * is where the head and the feet are. A wider camera keeps the baseline and loses its sides.
 */
export function previewAspectRatioForCamera(
  camera: { width: number; height: number } | null,
  baselineAspectRatio: number,
): number {
  if (camera === null || camera.width <= 0 || camera.height <= 0) {
    return baselineAspectRatio;
  }
  const cameraAspect = camera.width / camera.height;
  if (cameraAspect >= baselineAspectRatio) {
    return baselineAspectRatio;
  }
  return Math.max(cameraAspect, NARROWEST_PREVIEW_ASPECT_RATIO);
}
