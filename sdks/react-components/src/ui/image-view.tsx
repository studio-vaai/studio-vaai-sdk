"use client";

import type { FrameLock } from "@studio-vaai/js-machine";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { useState } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import { ImageZoomPortal } from "./image-zoom-portal.js";
import { useImageGesture } from "./use-image-gesture.js";

export type ImageViewProps = Omit<ComponentPropsWithoutRef<"img">, "src"> & {
  src: string;
  pending?: boolean;
  containerClassName?: string;
  withBackground?: boolean;
  /**
   * Enable Instagram-style pinch-to-zoom. The image will scale over its
   * container bounds (via a fixed-position portal) and spring back on release.
   */
  zoomable?: boolean;
  /**
   * Additional CSS styles for the container element (the rounded box that
   * hosts the img and receives the dynamic aspect-ratio). Caller-controlled
   * properties such as explicit `height` (when the image must match a sibling's
   * measured content height) take precedence over internally-computed values.
   */
  containerStyle?: CSSProperties | undefined;
  /**
   * Render only a normalized sub-rect of the source instead of the full image.
   * Used for camera captures where the user composed within a smaller bbox
   * than the sensor delivered: the Blob stays the full frame, but the lock
   * carries the bbox so display matches what the user actually saw. When
   * absent the full image is shown at its natural aspect.
   */
  frameLock?: FrameLock;
};

/** `width / height` of the displayed image rect (full frame or {@link FrameLock} crop). */
export function displayAspectRatioFromNatural(
  natural: { width: number; height: number },
  frameLock?: FrameLock,
): number {
  if (frameLock !== undefined) {
    return (natural.width * frameLock.width) / (natural.height * frameLock.height);
  }
  return natural.width / natural.height;
}

/**
 * Image preview with the same corner radius as primary buttons (`--sv-radius-button-primary`).
 * Pass `className` for layout (e.g. `h-full w-full`) and `object-*` as needed.
 */
export function ImageViewDefault({
  className,
  containerClassName,
  src,
  alt = "",
  draggable = false,
  pending = false,
  zoomable = false,
  withBackground = true,
  containerStyle: containerStyleProp,
  frameLock,
  onLoad: onLoadProp,
  ...imgProps
}: ImageViewProps) {
  const gesture = useImageGesture({ zoomEnabled: zoomable });
  // Track natural aspect so the container shrink-wraps to the image's bounds.
  // Without this the container fills its parent and `object-contain` letterboxes
  // the image, exposing the placeholder background as a border around it. When
  // `frameLock` is set we shrink-wrap to the cropped sub-rect instead of the
  // full image.
  const [natural, setNatural] = useState<{ width: number; height: number } | undefined>();

  const contentClassName = cn(
    "sv:block sv:rounded-[var(--sv-radius-button-primary)] sv:object-contain sv:h-full sv:w-full [dynamic-range-limit:constrained]",
    (draggable === false || draggable === "false") && "sv:[-webkit-user-drag:none]",
    className,
  );

  let aspectRatio: string | undefined;
  if (natural !== undefined) {
    if (typeof frameLock === "undefined") {
      aspectRatio = `${natural.width} / ${natural.height}`;
    } else {
      const cw = natural.width * frameLock.width;
      const ch = natural.height * frameLock.height;
      aspectRatio = `${cw} / ${ch}`;
    }
  }

  const containerStyle: CSSProperties = {};
  if (aspectRatio !== undefined) {
    containerStyle.aspectRatio = aspectRatio;
  }
  if (zoomable) {
    containerStyle.touchAction = "pan-x pan-y";
  }
  // When `frameLock` is set the img is `position: absolute` (taken out of
  // flow) so it can't drive the container's intrinsic size — `aspect-ratio`
  // alone collapses to 0 without a definite extent on either axis. Force
  // `width: 100%` so aspect-ratio has the parent's width to compute against.
  // The natural-aspect path doesn't need this: the in-flow img's intrinsic
  // dimensions size the container.
  if (frameLock !== undefined) {
    containerStyle.width = "100%";
  }
  const mergedContainerStyle: CSSProperties = {
    ...containerStyle,
    ...containerStyleProp,
  };

  // Sub-rect crop: scale the image so the lock's rect fills the container and
  // translate the upscaled image so the bbox's top-left lands on (0, 0) of
  // the container. Bbox top-left in normalized coords is `(cx - width/2,
  // cy - height/2)`; the img is `1/width` × `1/height` larger than the
  // container, so the offset (as a fraction of the container's own size) is
  // `(width/2 - cx) / width` horizontally and `(height/2 - cy) / height`
  // vertically.
  const cropImgStyle: CSSProperties | undefined =
    frameLock === undefined
      ? undefined
      : {
          position: "absolute",
          width: `${100 / frameLock.width}%`,
          height: `${100 / frameLock.height}%`,
          left: `${(100 * (frameLock.width / 2 - frameLock.cx)) / frameLock.width}%`,
          top: `${(100 * (frameLock.height / 2 - frameLock.cy)) / frameLock.height}%`,
          maxWidth: "none",
          maxHeight: "none",
        };

  return (
    <>
      <div
        ref={zoomable ? gesture.containerRef : undefined}
        // Let the drawer recognize this surface as exempt from swipe dismissal.
        // Its document-level touchmove listener runs before React handlers and
        // can otherwise cancel the native image callout on slight finger movement.
        data-base-ui-swipe-ignore=""
        className={cn(
          "sv:relative sv:block sv:max-w-full sv:max-h-full sv:overflow-hidden sv:rounded-[var(--sv-radius-button-primary)]",
          withBackground && "sv:bg-[var(--sv-color-image-placeholder)]",
          containerClassName,
        )}
        // Excluding pinch-zoom from `touch-action` is the linchpin for blocking
        // native iOS page-zoom: iOS ignores `user-scalable=no` and can grab the
        // gesture before any touchmove fires, so `preventDefault` alone is too late.
        style={mergedContainerStyle}
        {...(zoomable ? gesture.touchHandlers : undefined)}
      >
        {src.length > 0 ? (
          <img
            ref={zoomable ? gesture.imgRef : undefined}
            src={src}
            alt={alt}
            // A prolonged hold must not lift the image into native drag-and-drop.
            // Keep touch callouts enabled so the browser can still offer Save Image.
            draggable={draggable}
            className={contentClassName}
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }
              onLoadProp?.(e);
            }}
            style={{
              ...cropImgStyle,
              ...(zoomable && gesture.zoomActive ? { opacity: 0 } : {}),
            }}
            {...imgProps}
          />
        ) : (
          <div
            aria-hidden
            className={cn("sv:h-full sv:w-full sv:bg-[var(--sv-color-muted)]", className)}
          />
        )}
        {pending ? (
          <div aria-hidden className="sv-image-view-shine sv:absolute sv:inset-0" />
        ) : null}
      </div>
      {zoomable && gesture.portalState !== null ? (
        <ImageZoomPortal
          src={src}
          state={gesture.portalState}
          imgClassName="sv:block sv:w-full sv:h-full sv:object-contain sv:rounded-[var(--sv-radius-button-primary)]"
        />
      ) : null}
    </>
  );
}

export function ImageView(props: ImageViewProps) {
  const Comp = useStudioVaaiUiComponent("ImageView", ImageViewDefault);
  return <Comp {...props} />;
}
