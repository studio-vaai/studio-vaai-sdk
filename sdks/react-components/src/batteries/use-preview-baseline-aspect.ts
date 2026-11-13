"use client";

import type { CSSProperties } from "react";

import { useLayoutEffect, useState } from "react";

import type { SurfaceLandmarks } from "../ui/surface-landmarks.js";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { useSurfaceLandmarks } from "../surface-landmarks-context.js";

// Width / height baseline per surface. The preview frame is locked to this
// shape so the live capture, the uploading still, and the rejected preview all
// show the same cutout.
// - bottomSheet: portrait (W:H = 3:4).
// - modal: landscape (W:H = 4:3).
export const BASELINE_PREVIEW_ASPECT_RATIO_BOTTOM_SHEET = 3 / 4;
export const BASELINE_PREVIEW_ASPECT_RATIO_MODAL = 4 / 3;
// Matches ResponsiveSplit's `gap-4` between the frame and the content below it
// (see responsive-split.tsx).
const RESPONSIVE_SPLIT_GAP_PX = 16;
// Fallback when ModalContent max-height cannot be read from CSS.
const MODAL_POPUP_MAX_HEIGHT_VH = 0.95;
// Fallback when `--sv-sheet-max-height` cannot be read from CSS.
const SHEET_POPUP_MAX_HEIGHT_VH = 0.98;
// Fraction of content-below height kept visible when the sheet body scrolls.
const DEFAULT_BELOW_PEEK_FRACTION = 0.2;

/** Enable in devtools: `localStorage.setItem('sv-preview-baseline-debug', '1')` */
const PREVIEW_BASELINE_DEBUG_STORAGE_KEY = "sv-preview-baseline-debug";

function isPreviewBaselineDebugEnabled(): boolean {
  if (typeof globalThis === "undefined") {
    return false;
  }
  if (
    (globalThis as { __SV_PREVIEW_BASELINE_DEBUG__?: boolean }).__SV_PREVIEW_BASELINE_DEBUG__ ===
    true
  ) {
    return true;
  }
  try {
    return localStorage.getItem(PREVIEW_BASELINE_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Gated by `localStorage.setItem('sv-preview-baseline-debug', '1')` or `globalThis.__SV_PREVIEW_BASELINE_DEBUG__ = true`. */
export function previewBaselineDebug(message: string, detail?: Record<string, unknown>): void {
  if (!isPreviewBaselineDebugEnabled()) {
    return;
  }
  // oxlint-disable-next-line eslint/no-console -- opt-in preview baseline diagnostics
  console.log(`[preview-baseline] ${message}`, detail ?? "");
}

type FrameRefCallback = (el: HTMLDivElement | null) => void;

function readResolvedMaxHeightPx(el: HTMLElement): number | null {
  const { maxHeight } = getComputedStyle(el);
  if (maxHeight === "none") {
    return null;
  }
  const px = Number.parseFloat(maxHeight);
  return Number.isFinite(px) ? px : null;
}

function getShellMainPaddingY(shellMain: HTMLElement): number {
  const mainStyle = getComputedStyle(shellMain);
  return Number.parseFloat(mainStyle.paddingTop) + Number.parseFloat(mainStyle.paddingBottom);
}

/** Total height of every shell child that sits outside the scroll body (header, footer, …). */
function getShellChromeOutsideMain(shell: HTMLElement, shellMain: HTMLElement): number {
  let chrome = 0;
  for (const child of shell.children) {
    if (child !== shellMain) {
      chrome += (child as HTMLElement).offsetHeight;
    }
  }
  return chrome;
}

/**
 * Padding/inset between the popup interior and the shell — e.g. customer
 * `padding-bottom` on {@link BottomSheetContent} / {@link ModalContent}.
 */
function getPopupInsetAroundShell(
  popupEl: HTMLElement,
  shellEl: HTMLElement,
): { aboveShell: number; belowShell: number } {
  const popupRect = popupEl.getBoundingClientRect();
  const shellRect = shellEl.getBoundingClientRect();
  const popupStyle = getComputedStyle(popupEl);
  const padTop = Number.parseFloat(popupStyle.paddingTop);
  const padBottom = Number.parseFloat(popupStyle.paddingBottom);
  const interiorTop = popupRect.top + padTop;
  const interiorBottom = popupRect.bottom - padBottom;
  return {
    aboveShell: Math.max(0, shellRect.top - interiorTop),
    belowShell: Math.max(0, interiorBottom - shellRect.bottom),
  };
}

function getShellMainInnerBudget(frameEl: HTMLElement, landmarks: SurfaceLandmarks): number | null {
  const shellMain = landmarks.resolveShellMain(frameEl);
  if (shellMain === null) {
    return null;
  }
  const shell = landmarks.resolveShell(frameEl);
  const popup = landmarks.resolvePopup(frameEl);
  if (shell === null || popup === null) {
    return null;
  }
  const cap = getSurfacePopupCap(popup);
  const { aboveShell, belowShell } = getPopupInsetAroundShell(popup, shell);
  const shellChrome = getShellChromeOutsideMain(shell, shellMain);
  const mainPaddingY = getShellMainPaddingY(shellMain);
  return cap - aboveShell - belowShell - shellChrome - mainPaddingY;
}

/** Live inner height of the scroll body (what is visible at scroll-top). */
function getShellMainVisibleBody(frameEl: HTMLElement, landmarks: SurfaceLandmarks): number | null {
  const shellMain = landmarks.resolveShellMain(frameEl);
  if (shellMain === null) {
    return null;
  }
  return shellMain.clientHeight - getShellMainPaddingY(shellMain);
}

function getSurfacePopupCap(popupEl: HTMLElement): number {
  const fromCss = readResolvedMaxHeightPx(popupEl);
  if (fromCss !== null) {
    return fromCss;
  }
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const vhFactor = popupEl.classList.contains("sv-modal-content")
    ? MODAL_POPUP_MAX_HEIGHT_VH
    : SHEET_POPUP_MAX_HEIGHT_VH;
  return Math.min(viewportHeight * vhFactor, viewportHeight);
}

function getContentBelowHeight(contentBelowEl: HTMLElement | null): number {
  if (contentBelowEl !== null && contentBelowEl.offsetHeight > 0) {
    return contentBelowEl.offsetHeight + RESPONSIVE_SPLIT_GAP_PX;
  }
  return 0;
}

function isContentBelowPending(contentBelowEl: HTMLElement | null): boolean {
  return (
    contentBelowEl !== null &&
    contentBelowEl.childElementCount > 0 &&
    contentBelowEl.offsetHeight === 0
  );
}

function isPopupEnterAnimating(frameEl: HTMLElement, landmarks: SurfaceLandmarks): boolean {
  const popup = landmarks.resolvePopup(frameEl);
  return popup !== null && landmarks.isPopupEnterAnimating(popup);
}

function resolveScrollAwareFrameHeight(
  expandedHeight: number,
  availableForFrame: number,
  minShrinkScale: number,
): number {
  const minShrinkHeight = expandedHeight * minShrinkScale;
  let reason: string;
  let height: number;
  if (availableForFrame >= expandedHeight) {
    reason = "fits-expanded";
    height = expandedHeight;
  } else if (availableForFrame < minShrinkHeight) {
    reason = "below-min-shrink-scroll-at-expanded";
    height = expandedHeight;
  } else {
    reason = "shrink-to-budget";
    height = availableForFrame;
  }
  previewBaselineDebug("modal scroll-aware height", {
    reason,
    expandedHeight,
    availableForFrame,
    minShrinkScale,
    minShrinkHeight,
    chosenHeight: height,
  });
  return height;
}

function getBelowPeekFraction(override?: number): number {
  if (override !== undefined) {
    return Math.min(Math.max(override, 0), 1);
  }
  return DEFAULT_BELOW_PEEK_FRACTION;
}

function getBelowContentHeight(belowHeight: number): number {
  return belowHeight <= RESPONSIVE_SPLIT_GAP_PX ? 0 : belowHeight - RESPONSIVE_SPLIT_GAP_PX;
}

/**
 * Bottom sheet scroll-aware frame height.
 *
 * Priority: natural size at cap → shrink to cap → shrink to live viewport →
 * scroll with a content-below peek affordance.
 */
function resolveBottomSheetScrollAwareFrameHeight(
  fullExpandedHeight: number,
  capBodyBudget: number,
  visibleBody: number,
  belowHeight: number,
  minShrinkScale: number,
  belowPeekFraction: number,
  hasContentBelow: boolean,
): number {
  const minShrinkHeight = fullExpandedHeight * minShrinkScale;

  const effectiveCap = Math.min(capBodyBudget, visibleBody);

  if (!hasContentBelow) {
    previewBaselineDebug("bottom-sheet: no content below — delegating to modal resolver", {
      fullExpandedHeight,
      capBodyBudget,
      visibleBody,
      effectiveCap,
      minShrinkScale,
    });
    return resolveScrollAwareFrameHeight(fullExpandedHeight, effectiveCap, minShrinkScale);
  }

  if (fullExpandedHeight + belowHeight <= effectiveCap) {
    previewBaselineDebug("bottom-sheet scroll-aware height", {
      reason: "frame-and-below-fit-cap",
      fullExpandedHeight,
      capBodyBudget,
      visibleBody,
      effectiveCap,
      belowHeight,
      minShrinkHeight,
      chosenHeight: fullExpandedHeight,
    });
    return fullExpandedHeight;
  }

  const capFitFrame = effectiveCap - belowHeight;
  if (capFitFrame >= minShrinkHeight) {
    const chosenHeight = Math.min(fullExpandedHeight, capFitFrame);
    previewBaselineDebug("bottom-sheet scroll-aware height", {
      reason: "shrink-to-cap-minus-below",
      fullExpandedHeight,
      capBodyBudget,
      visibleBody,
      belowHeight,
      capFitFrame,
      minShrinkHeight,
      chosenHeight,
    });
    return chosenHeight;
  }

  const visibleFitFrame = visibleBody - belowHeight;
  if (visibleFitFrame >= minShrinkHeight) {
    const chosenHeight = Math.min(fullExpandedHeight, visibleFitFrame);
    previewBaselineDebug("bottom-sheet scroll-aware height", {
      reason: "shrink-to-visible-minus-below",
      fullExpandedHeight,
      capBodyBudget,
      visibleBody,
      belowHeight,
      visibleFitFrame,
      minShrinkHeight,
      chosenHeight,
    });
    return chosenHeight;
  }

  const belowContentHeight = getBelowContentHeight(belowHeight);
  const belowPeek = belowContentHeight * belowPeekFraction;
  const frameMaxWithPeek = visibleBody - RESPONSIVE_SPLIT_GAP_PX - belowPeek;
  if (frameMaxWithPeek <= 0) {
    previewBaselineDebug("bottom-sheet scroll-aware height", {
      reason: "peek-budget-exhausted-min-shrink",
      fullExpandedHeight,
      capBodyBudget,
      visibleBody,
      belowHeight,
      belowPeekFraction,
      belowPeek,
      frameMaxWithPeek,
      minShrinkHeight,
      chosenHeight: minShrinkHeight,
    });
    return minShrinkHeight;
  }

  const fitHeight = Math.min(fullExpandedHeight, frameMaxWithPeek);
  if (fitHeight >= minShrinkHeight) {
    previewBaselineDebug("bottom-sheet scroll-aware height", {
      reason: "shrink-with-below-peek-affordance",
      fullExpandedHeight,
      capBodyBudget,
      visibleBody,
      belowHeight,
      belowPeekFraction,
      belowPeek,
      frameMaxWithPeek,
      minShrinkHeight,
      chosenHeight: fitHeight,
    });
    return fitHeight;
  }
  previewBaselineDebug("bottom-sheet scroll-aware height", {
    reason: "below-min-shrink-after-peek",
    fullExpandedHeight,
    capBodyBudget,
    visibleBody,
    belowHeight,
    belowPeekFraction,
    belowPeek,
    frameMaxWithPeek,
    fitHeight,
    minShrinkHeight,
    chosenHeight: minShrinkHeight,
  });
  return minShrinkHeight;
}

interface PreviewBaselineAspectOptions {
  /**
   * The frame shrinks to keep the sheet scroll-free on shorter viewports; once it
   * would have to shrink below `minShrinkScale` of its full-width size it instead
   * stays expanded and the shell body scrolls (bottom sheet) or clips (modal).
   * Requires {@link PreviewBaselineAspect.frameRef | frameRef} on the frame and
   * {@link PreviewBaselineAspect.contentBelowRef | contentBelowRef} on the
   * element rendered directly below it.
   */
  scrollAware?: boolean;
  /**
   * Smallest fraction of the full-width height the frame shrinks to before the
   * sheet scrolls instead of cramming. Defaults to `0.6`.
   */
  minShrinkScale?: number;
  /**
   * Bottom sheet only. Smallest fraction of measured content-below height kept
   * visible at the bottom of the scrollport when the body scrolls. Defaults to `0.2`.
   */
  belowPeekFraction?: number;
  /**
   * When false and `overrideAspectRatio` is omitted, the hook waits for an
   * explicit aspect (e.g. from image natural dimensions) instead of falling
   * back to the surface baseline.
   */
  fallbackToBaseline?: boolean;
}

interface PreviewBaselineAspect {
  /** The frame's `width / height` ratio. */
  aspectRatio: number;
  /** Attach to the preview frame element. */
  frameRef: FrameRefCallback;
  /** Attach to the element rendered directly below the frame (`scrollAware`). */
  contentBelowRef: FrameRefCallback;
  /** Tailwind classes for the frame element. */
  frameFitClass: string;
  /** Inline styles for the frame element (pairs with {@link frameFitClass}). */
  frameStyle: CSSProperties;
}

/**
 * Surface-aware sizing for the photo flow's preview frame. The frame keeps the
 * active surface's baseline shape and scales to fit; the image inside always
 * uses `object-cover` so it center-crops to that shape — there are never
 * letterbox bars.
 *
 * With `scrollAware` the frame additionally measures the available height and:
 * - shows itself expanded (full width) when frame + content-below fits the cap;
 * - otherwise shrinks to fit at the sheet cap, then the live viewport, before
 *   allowing the shell body to scroll;
 * - when scroll is unavoidable, keeps `belowPeekFraction` of content-below
 *   visible as a scroll affordance, down to `minShrinkScale`;
 * - on image-only screens, shrinks down to `minShrinkScale` then scrolls at full
 *   expanded height;
 *
 * @param overrideAspectRatio Optional explicit `width / height`; when omitted
 *   the active surface's baseline is used unless `fallbackToBaseline` is false.
 */
export function usePreviewBaselineAspect(
  overrideAspectRatio?: number,
  options?: PreviewBaselineAspectOptions,
): PreviewBaselineAspect {
  const isBottomSheet = useStudioVaaiUi().responsive.layout === "bottomSheet";
  const baseline = isBottomSheet
    ? BASELINE_PREVIEW_ASPECT_RATIO_BOTTOM_SHEET
    : BASELINE_PREVIEW_ASPECT_RATIO_MODAL;
  const aspectRatio =
    overrideAspectRatio ?? (options?.fallbackToBaseline !== false ? baseline : undefined);
  let aspectSource: "override" | "pending-explicit" | "surface-baseline";
  if (overrideAspectRatio !== undefined) {
    aspectSource = "override";
  } else if (options?.fallbackToBaseline === false) {
    aspectSource = "pending-explicit";
  } else {
    aspectSource = "surface-baseline";
  }
  const minShrinkScale = options?.minShrinkScale ?? 0.6;
  const belowPeekFraction = options?.belowPeekFraction;
  const measuring = (options?.scrollAware ?? false) && aspectRatio !== undefined;
  const landmarks = useSurfaceLandmarks();

  previewBaselineDebug("hook config", {
    layout: isBottomSheet ? "bottomSheet" : "modal",
    baseline,
    aspectRatio,
    aspectSource,
    overrideAspectRatio,
    scrollAware: options?.scrollAware ?? false,
    fallbackToBaseline: options?.fallbackToBaseline !== false,
    measuring,
    minShrinkScale,
    belowPeekFraction,
  });

  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const [contentBelowEl, setContentBelowEl] = useState<HTMLDivElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!measuring || frameEl === null || aspectRatio === undefined) {
      return;
    }
    const widthEl = frameEl.parentElement;
    if (widthEl === null) {
      return;
    }

    let cancelled = false;

    const commitHeight = (height: number): void => {
      const floored = Math.floor(height);
      setMeasuredHeight((prev) => (prev === floored ? prev : floored));
    };

    const measureBottomSheet = (): boolean => {
      if (isPopupEnterAnimating(frameEl, landmarks)) {
        previewBaselineDebug("bottom-sheet measure skipped", { reason: "popup-enter-animating" });
        return false;
      }
      if (isContentBelowPending(contentBelowEl)) {
        previewBaselineDebug("bottom-sheet measure skipped", { reason: "content-below-pending" });
        return false;
      }
      const fullWidth = widthEl.clientWidth;
      if (fullWidth === 0) {
        previewBaselineDebug("bottom-sheet measure skipped", { reason: "zero-width" });
        return false;
      }
      const capBodyBudget = getShellMainInnerBudget(frameEl, landmarks);
      const visibleBody = getShellMainVisibleBody(frameEl, landmarks);
      if (
        capBodyBudget === null ||
        capBodyBudget <= 0 ||
        visibleBody === null ||
        visibleBody <= 0
      ) {
        previewBaselineDebug("bottom-sheet measure skipped", {
          reason: "invalid-shell-budget",
          capBodyBudget,
          visibleBody,
        });
        return false;
      }
      const belowHeight = getContentBelowHeight(contentBelowEl);
      const hasContentBelow = belowHeight > 0;
      const expandedHeight = fullWidth / aspectRatio;
      commitHeight(
        resolveBottomSheetScrollAwareFrameHeight(
          expandedHeight,
          capBodyBudget,
          visibleBody,
          belowHeight,
          minShrinkScale,
          getBelowPeekFraction(belowPeekFraction),
          hasContentBelow,
        ),
      );
      return true;
    };

    const measureModal = (): boolean => {
      const fullWidth = widthEl.clientWidth;
      if (fullWidth === 0) {
        previewBaselineDebug("modal measure skipped", { reason: "zero-width" });
        return false;
      }
      const budget = getShellMainInnerBudget(frameEl, landmarks);
      const visibleBody = getShellMainVisibleBody(frameEl, landmarks);
      if (budget === null || budget <= 0 || visibleBody === null || visibleBody <= 0) {
        previewBaselineDebug("modal measure skipped", {
          reason: "invalid-shell-budget",
          budget,
          visibleBody,
        });
        return false;
      }
      const expandedHeight = fullWidth / aspectRatio;
      const effectiveCap = Math.min(budget, visibleBody);
      commitHeight(resolveScrollAwareFrameHeight(expandedHeight, effectiveCap, minShrinkScale));
      return true;
    };

    const measure = (): void => {
      if (cancelled) {
        return;
      }
      if (isBottomSheet) {
        measureBottomSheet();
        return;
      }
      measureModal();
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(widthEl);

    const shell = landmarks.resolveShell(frameEl);
    if (shell !== null) {
      for (const child of shell.children) {
        if (child instanceof HTMLElement) {
          observer.observe(child);
        }
      }
    }
    if (contentBelowEl !== null) {
      observer.observe(contentBelowEl);
    }

    const popup = landmarks.resolvePopup(frameEl);
    const onPopupSettled = (): void => {
      measure();
    };
    if (popup !== null) {
      observer.observe(popup);
      popup.addEventListener("transitionend", onPopupSettled);
      const openObserver = new MutationObserver(onPopupSettled);
      openObserver.observe(popup, {
        attributes: true,
        attributeFilter: ["data-starting-style"],
      });
      window.addEventListener("resize", onPopupSettled);
      return () => {
        cancelled = true;
        observer.disconnect();
        openObserver.disconnect();
        popup.removeEventListener("transitionend", onPopupSettled);
        window.removeEventListener("resize", onPopupSettled);
      };
    }

    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [
    measuring,
    frameEl,
    contentBelowEl,
    aspectRatio,
    minShrinkScale,
    belowPeekFraction,
    isBottomSheet,
    landmarks,
  ]);

  const frameStyle: CSSProperties = {};
  let heightMode: "none" | "measured-px" | "container-query-calc" = "none";
  if (aspectRatio !== undefined) {
    frameStyle.aspectRatio = aspectRatio;
    if (measuring && measuredHeight !== null) {
      frameStyle.height = `${measuredHeight}px`;
      heightMode = "measured-px";
    } else if (measuring || isBottomSheet) {
      frameStyle.height = `calc(100cqw / ${aspectRatio})`;
      heightMode = "container-query-calc";
    }
  }

  let scrollAwareFrameFitClass: string;
  if (measuring) {
    scrollAwareFrameFitClass = "sv:w-auto sv:max-w-full sv:shrink-0 sv:mx-auto";
  } else if (isBottomSheet) {
    scrollAwareFrameFitClass = "sv:w-auto sv:max-w-full sv:min-h-0 sv:mx-auto";
  } else {
    // `box-border` is load-bearing. The SDK ships prefixed Tailwind WITHOUT preflight so it
    // cannot restyle a host page, which leaves boxes at the CSS default `content-box` — padding
    // then adds to `w-full` instead of fitting inside it. Measured in the modal's two-column
    // split: a 480px column, the frame's `width` computing to 480px, and a used box of 528px —
    // exactly the 24px of `px-6` on each side — which ran the photo-capture panels 16px under
    // the CTA beside them. Neither `max-w-full` nor `min-w-0` clamps this; only border-box does,
    // because the overflow is padding outside the width rather than the width being too large.
    scrollAwareFrameFitClass = "sv:box-border sv:w-full";
  }

  previewBaselineDebug("frame style applied", {
    aspectRatio: aspectRatio ?? baseline,
    measuring,
    measuredHeight,
    heightMode,
    frameStyle,
    frameFitClass: scrollAwareFrameFitClass,
  });

  return {
    aspectRatio: aspectRatio ?? baseline,
    frameRef: setFrameEl,
    contentBelowRef: setContentBelowEl,
    frameFitClass: scrollAwareFrameFitClass,
    frameStyle,
  };
}
