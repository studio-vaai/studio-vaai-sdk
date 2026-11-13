"use client";

import type { FrameLock } from "@studio-vaai/js-machine";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { cn } from "../ui/cn.js";
import { displayAspectRatioFromNatural, ImageView, type ImageViewProps } from "../ui/image-view.js";
import {
  BASELINE_PREVIEW_ASPECT_RATIO_BOTTOM_SHEET,
  BASELINE_PREVIEW_ASPECT_RATIO_MODAL,
  previewBaselineDebug,
  usePreviewBaselineAspect,
} from "./use-preview-baseline-aspect.js";

/** Props that make {@link ImageView} fill a scroll-aware frame without sizing itself. */
const scrollAwareImageViewFillProps = {
  containerClassName: "sv:h-full sv:w-full",
  containerStyle: { height: "100%", width: "100%", aspectRatio: "unset" } satisfies CSSProperties,
};

// Rounded to match the try-on hero and the picker card: this is the shopper's own photo on the
// size step, and the same photo is rounded one step later on the result screen.
const scrollAwareFrameClassName =
  "sv:relative sv:flex sv:min-h-0 sv:items-center sv:justify-center sv:overflow-hidden sv:rounded-[var(--sv-radius-control)]";

/** Static frame for photo capture uploading (no scroll-aware sizing). */
const staticPreviewFrameClassName =
  "sv:relative sv:flex sv:flex-col sv:min-h-[40dvh] sv:w-full sv:flex-1 sv:min-w-0 sv:overflow-hidden";

const staticPreviewImageWrapClassName =
  "sv:flex sv:min-h-0 sv:w-full sv:flex-1 sv:items-center sv:justify-center";

/**
 * Pick the aspect ratio to render with before (and after) the image's natural
 * dimensions are known. Priority cascade: a known `displayAspectRatio` (from a
 * completed image load) wins; otherwise an empty `previewSrc` falls back to the
 * placeholder; a `frameLock` snaps to the surface baseline; a pending `previewSrc`
 * holds the placeholder; finally everything else lands on the surface baseline.
 * Picking a sensible provisional value up front avoids a layout jump when the
 * real aspect arrives via `onPreviewLoad`.
 */
function provisionalPreviewAspectRatio(
  previewSrc: string,
  isBottomSheet: boolean,
  frameLock: FrameLock | undefined,
  placeholderAspectRatio: number | undefined,
  displayAspectRatio?: number,
): number | undefined {
  const layout = isBottomSheet ? "bottomSheet" : "modal";
  if (displayAspectRatio !== undefined) {
    previewBaselineDebug("provisional aspect chosen", {
      reason: "display-from-image-load",
      layout,
      aspectRatio: displayAspectRatio,
      previewSrcLength: previewSrc.length,
      hasFrameLock: frameLock !== undefined,
    });
    return displayAspectRatio;
  }
  if (previewSrc.length === 0) {
    previewBaselineDebug("provisional aspect chosen", {
      reason: "empty-src-placeholder",
      layout,
      aspectRatio: placeholderAspectRatio,
      placeholderAspectRatio,
    });
    return placeholderAspectRatio;
  }
  if (frameLock !== undefined) {
    const aspectRatio = isBottomSheet
      ? BASELINE_PREVIEW_ASPECT_RATIO_BOTTOM_SHEET
      : BASELINE_PREVIEW_ASPECT_RATIO_MODAL;
    previewBaselineDebug("provisional aspect chosen", {
      reason: "frame-lock-surface-baseline",
      layout,
      aspectRatio,
      hasFrameLock: true,
    });
    return aspectRatio;
  }
  if (placeholderAspectRatio !== undefined) {
    previewBaselineDebug("provisional aspect chosen", {
      reason: "placeholder-while-src-pending-natural",
      layout,
      aspectRatio: placeholderAspectRatio,
      previewSrcLength: previewSrc.length,
    });
    return placeholderAspectRatio;
  }
  const aspectRatio = isBottomSheet
    ? BASELINE_PREVIEW_ASPECT_RATIO_BOTTOM_SHEET
    : BASELINE_PREVIEW_ASPECT_RATIO_MODAL;
  previewBaselineDebug("provisional aspect chosen", {
    reason: "surface-baseline-fallback",
    layout,
    aspectRatio,
    previewSrcLength: previewSrc.length,
  });
  return aspectRatio;
}

interface UseNaturalAspectPreviewFrameOptions {
  /** Aspect used when `previewSrc` is empty. */
  placeholderAspectRatio?: number;
  /** Extra classes merged onto the outer frame element. */
  frameClassName?: string;
  /**
   * When true (default), sizes the frame from natural aspect with the
   * scroll-aware shrinking implemented by {@link usePreviewBaselineAspect}.
   * Photo capture sets this to false.
   */
  scrollAware?: boolean;
  /**
   * Forwarded to {@link usePreviewBaselineAspect}: how far below the baseline the frame may
   * shrink to make room for the content below it. Screens whose photo must never overlap
   * their controls (the overlay-stack layouts) pass `0` so it can give up all its height.
   */
  minShrinkScale?: number;
}

/**
 * Shared natural-aspect preview frame. Default: scroll-aware sizing on modal
 * and bottom sheet. Photo capture opts out via `scrollAware: false`.
 */
export function useNaturalAspectPreviewFrame(
  previewSrc: string,
  frameLock?: FrameLock,
  options?: UseNaturalAspectPreviewFrameOptions,
) {
  const isBottomSheet = useStudioVaaiUi().responsive.layout === "bottomSheet";
  const scrollAware = options?.scrollAware ?? true;
  const placeholderAspectRatio = options?.placeholderAspectRatio;
  const [displayAspectRatio, setDisplayAspectRatio] = useState<number | undefined>(() =>
    provisionalPreviewAspectRatio(previewSrc, isBottomSheet, frameLock, placeholderAspectRatio),
  );
  const staticFrameRef = useRef<HTMLDivElement | null>(null);
  const setStaticFrameRef = useCallback((el: HTMLDivElement | null) => {
    staticFrameRef.current = el;
  }, []);
  const staticContentBelowRef = useRef<HTMLDivElement | null>(null);
  const setStaticContentBelowRef = useCallback((el: HTMLDivElement | null) => {
    staticContentBelowRef.current = el;
  }, []);

  const resolvedAspect = provisionalPreviewAspectRatio(
    previewSrc,
    isBottomSheet,
    frameLock,
    placeholderAspectRatio,
    displayAspectRatio,
  );

  const {
    frameRef: scrollFrameRef,
    contentBelowRef: scrollContentBelowRef,
    frameFitClass,
    frameStyle,
  } = usePreviewBaselineAspect(resolvedAspect, {
    scrollAware,
    fallbackToBaseline: false,
    ...(options?.minShrinkScale === undefined ? {} : { minShrinkScale: options.minShrinkScale }),
  });

  useEffect(() => {
    previewBaselineDebug("natural-aspect preview frame", {
      scrollAware,
      resolvedAspect,
      previewSrcLength: previewSrc.length,
      hasFrameLock: frameLock !== undefined,
      placeholderAspectRatio,
    });
  }, [scrollAware, resolvedAspect, previewSrc, frameLock, placeholderAspectRatio]);

  useEffect(() => {
    if (previewSrc.length === 0) {
      setDisplayAspectRatio(placeholderAspectRatio);
    }
  }, [previewSrc, placeholderAspectRatio]);

  const onPreviewLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const aspectRatio = displayAspectRatioFromNatural(
          { width: img.naturalWidth, height: img.naturalHeight },
          frameLock,
        );
        previewBaselineDebug("image natural aspect applied", {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          aspectRatio,
          hasFrameLock: frameLock !== undefined,
          frameLock,
        });
        setDisplayAspectRatio(aspectRatio);
      }
    },
    [frameLock],
  );

  const imageContainerClassName =
    previewSrc.length === 0 && placeholderAspectRatio !== undefined
      ? "sv:w-full sv:aspect-[3/4]"
      : undefined;

  if (!scrollAware) {
    previewBaselineDebug("natural-aspect preview frame mode", {
      mode: "static-no-scroll-aware",
      frameClassName: cn(staticPreviewFrameClassName, options?.frameClassName),
    });
    return {
      frameRef: setStaticFrameRef,
      contentBelowRef: setStaticContentBelowRef,
      scrollAware: false as const,
      frameClassName: cn(staticPreviewFrameClassName, options?.frameClassName),
      frameStyle: {} satisfies CSSProperties,
      imageWrapClassName: staticPreviewImageWrapClassName,
      imageContainerClassName,
      onPreviewLoad: undefined,
    };
  }

  return {
    frameRef: scrollFrameRef,
    contentBelowRef: scrollContentBelowRef,
    scrollAware: true as const,
    frameClassName: cn(scrollAwareFrameClassName, frameFitClass, options?.frameClassName),
    frameStyle,
    imageWrapClassName: undefined,
    imageContainerClassName,
    onPreviewLoad,
  };
}

type NaturalAspectPreviewFrameProps = {
  frameRef: (el: HTMLDivElement | null) => void;
  frameClassName: string;
  frameStyle: CSSProperties;
  scrollAware: boolean;
  imageWrapClassName?: string | undefined;
  previewSrc: string;
  frameLock?: FrameLock;
  imageContainerClassName?: string | undefined;
  onPreviewLoad?: ((e: SyntheticEvent<HTMLImageElement>) => void) | undefined;
  overlay?: ReactNode;
  /**
   * Accepted-and-ignored: callers spread the whole {@link useNaturalAspectPreviewFrame}
   * return (`{...previewFrame}`) into this frame, but `contentBelowRef` belongs to the
   * sibling "content below" element the screen renders itself. Declared + destructured
   * so it doesn't fall through to `...imageProps` and land on the DOM `<img>`.
   */
  contentBelowRef?: ((el: HTMLDivElement | null) => void) | undefined;
} & Omit<ImageViewProps, "src" | "containerClassName" | "containerStyle" | "onLoad">;

function staticModeImageViewSpread(
  imageContainerClassName: string | undefined,
): Pick<ImageViewProps, "containerClassName"> | Record<string, never> {
  if (imageContainerClassName !== undefined) {
    return { containerClassName: imageContainerClassName };
  }
  return {};
}

/** Frame + {@link ImageView} wired for scroll-aware or static preview layout. */
export function NaturalAspectPreviewFrame({
  frameRef,
  frameClassName,
  frameStyle,
  scrollAware,
  imageWrapClassName,
  previewSrc,
  frameLock,
  imageContainerClassName,
  onPreviewLoad,
  overlay,
  // Swallowed: belongs to the screen's sibling content-below element, not the image.
  contentBelowRef: _contentBelowRef,
  ...imageProps
}: NaturalAspectPreviewFrameProps) {
  const imageViewSpread = scrollAware
    ? scrollAwareImageViewFillProps
    : staticModeImageViewSpread(imageContainerClassName);

  const image = (
    <ImageView
      src={previewSrc}
      {...imageViewSpread}
      {...(scrollAware && onPreviewLoad !== undefined ? { onLoad: onPreviewLoad } : {})}
      {...(frameLock === undefined ? {} : { frameLock })}
      {...imageProps}
    />
  );

  return (
    <div ref={frameRef} className={frameClassName} style={frameStyle}>
      {scrollAware || imageWrapClassName === undefined ? (
        image
      ) : (
        <div className={imageWrapClassName}>{image}</div>
      )}
      {overlay}
    </div>
  );
}
