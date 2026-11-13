import type { SvImageCrop } from "./image-crop.js";

import { imageCrop } from "./image-crop.js";

/** A common composition for images registered to the same canvas. Property only. */
export interface SvImageFraming {
  /** Protect the supplied bounds (default), or fill the allocated backdrop edge-to-edge. */
  fit?: "protect" | "cover" | undefined;
  /** Reference width / height after the explicit source crop. Pin this before loading when known. */
  aspectRatio?: number | undefined;
  /** Protected region in that reference canvas. Supply the union across comparable results. */
  bounds?: SvImageCrop | undefined;
  /** Breathing room on each frame edge, as a fraction of that dimension (0–0.25). Default 0.05. */
  margin?: number | undefined;
  /** Align the fitted reference canvas to the bottom of its stage when there is extra space. */
  blockAlign?: "end" | undefined;
}

interface ImageRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageFraming extends ImageRectangle {
  /** Image-covered part of the stage. Unused space stays outside this pane. */
  frame: ImageRectangle;
}

/** Enables conservative, stable framing when result metadata has not been supplied. */
export const STABLE_IMAGE_FRAMING: Readonly<SvImageFraming> = Object.freeze({});

/** Review screens share their controls' gutters; no second inset around the photo. */
export function photoImageFraming(framing: SvImageFraming | undefined): SvImageFraming | undefined {
  return framing === undefined ? undefined : { margin: 0, ...framing };
}

/** An always-open selector overlays the full photo backdrop, as on the original screen. */
export function backdropImageFraming(framing?: SvImageFraming): SvImageFraming {
  return { ...framing, fit: "cover", margin: 0 };
}

export function validImageAspect(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > Number.EPSILON;
}

function position(
  length: number,
  start: number,
  end: number,
  source: number,
  padding: number,
  scale: number,
): number {
  const low = padding - scale * start;
  const high = length - padding - scale * end;
  const preferred = length / 2 - (scale * (start + end)) / 2;
  // Prefer a covered canvas, or centered letterboxing if the source is smaller.
  // Subject safety wins when that interval cannot satisfy both constraints.
  const sourceLow = scale * source >= length ? length - scale * source : 0;
  const sourceHigh = scale * source >= length ? 0 : length - scale * source;
  const a = Math.max(low, sourceLow);
  const b = Math.min(high, sourceHigh);
  return a <= b ? Math.max(a, Math.min(b, preferred)) : Math.max(low, Math.min(high, preferred));
}

/** Pure solver. All sources fit uniformly into one reference canvas before framing it. */
export function resolveImageFraming(
  viewport: { width: number; height: number },
  sourceAspect: number,
  referenceAspect: number,
  framing: SvImageFraming,
): ImageFraming | undefined {
  if (
    !validImageAspect(sourceAspect) ||
    !validImageAspect(referenceAspect) ||
    !validImageAspect(viewport.width) ||
    !validImageAspect(viewport.height)
  ) {
    return undefined;
  }
  const bounds = imageCrop(framing.bounds);
  if (framing.fit === "cover") {
    const width = Math.max(viewport.width, viewport.height * sourceAspect);
    const height = width / sourceAspect;
    const x = Math.max(viewport.width - width, Math.min(0, viewport.width / 2 - bounds.cx * width));
    const y = Math.max(
      viewport.height - height,
      Math.min(0, viewport.height / 2 - bounds.cy * height),
    );
    return { x, y, width, height, frame: { x: 0, y: 0, ...viewport } };
  }
  const margin =
    framing.margin !== undefined &&
    Number.isFinite(framing.margin) &&
    framing.margin >= 0 &&
    framing.margin <= 0.25
      ? framing.margin
      : 0.05;
  const x = (bounds.cx - bounds.width / 2) * referenceAspect;
  const y = bounds.cy - bounds.height / 2;
  const width = bounds.width * referenceAspect;
  const { height } = bounds;
  const scale = Math.min(
    (viewport.width * (1 - 2 * margin)) / width,
    (viewport.height * (1 - 2 * margin)) / height,
  );
  const tx = position(
    viewport.width,
    x,
    x + width,
    referenceAspect,
    viewport.width * margin,
    scale,
  );
  const ty = position(viewport.height, y, y + height, 1, viewport.height * margin, scale);
  const sourceHeight = Math.min(1, referenceAspect / sourceAspect);
  const sourceWidth = sourceAspect * sourceHeight;
  const blockOffset = framing.blockAlign === "end" ? Math.max(0, viewport.height - ty - scale) : 0;
  const image = {
    x: tx + ((referenceAspect - sourceWidth) * scale) / 2,
    y: ty + blockOffset + ((1 - sourceHeight) * scale) / 2,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
  const left = Math.max(0, image.x);
  const top = Math.max(0, image.y);
  return {
    ...image,
    frame: {
      x: left,
      y: top,
      width: Math.max(0, Math.min(viewport.width, image.x + image.width) - left),
      height: Math.max(0, Math.min(viewport.height, image.y + image.height) - top),
    },
  };
}

/** Full-source normalized points follow sv-image's exact crop/framing transform. */
export function imagePointStyle(x: number, y: number): { left: string; top: string } {
  return {
    left: `calc(var(--sv-image-content-left, 0%) + ${String(x)} * var(--sv-image-content-width, 100%))`,
    top: `calc(var(--sv-image-content-top, 0%) + ${String(y)} * var(--sv-image-content-height, 100%))`,
  };
}
