"use client";

import { createPortal } from "react-dom";

import { useStudioVaaiTheme } from "../theme-context.js";
import { cn } from "./cn.js";
import { StudioVaaiRoot } from "./studio-vaai-root.js";

export interface ZoomPortalState {
  /** True while fingers are down; false during the spring-back animation. */
  pinching: boolean;
  /** Viewport rect of the original image captured at gesture start. */
  imgRect: DOMRect;
  /** CSS transform applied to the fixed-positioned portal element. */
  transform: string;
  /** 0–1; ramps linearly with scale from `1` (clear) to `MAX_SCALE` (full dim). */
  backdropOpacity: number;
}

/**
 * Fixed-position overlay rendered into document.body during an active pinch
 * gesture. Owns the dim backdrop and the lifted image clone — both share the
 * pinching/springing transition split. Pass an `imgClassName` whose object-fit
 * matches the source image (`object-contain` for ImageView, `object-cover` for
 * the try-on hero).
 */
export function ImageZoomPortal({
  src,
  state,
  imgClassName,
}: {
  src: string;
  state: ZoomPortalState;
  imgClassName: string;
}) {
  const theme = useStudioVaaiTheme();
  return createPortal(
    // `#studio-vaai-root` re-established inside the portal so the prefixed
    // stylesheet (postcss-prefix-selector) matches inside document.body.
    <StudioVaaiRoot tokens={theme}>
      <div
        aria-hidden
        className={cn(
          "sv-image-zoom-backdrop",
          state.pinching ? "sv-image-zoom-backdrop--pinching" : "sv-image-zoom-backdrop--springing",
        )}
        style={{ opacity: state.backdropOpacity }}
      />
      <div
        aria-hidden
        className={cn(
          "sv-image-zoom-portal",
          state.pinching ? "sv-image-zoom-portal--pinching" : "sv-image-zoom-portal--springing",
        )}
        style={{
          top: state.imgRect.top,
          left: state.imgRect.left,
          width: state.imgRect.width,
          height: state.imgRect.height,
          transform: state.transform,
        }}
      >
        <img
          src={src}
          alt=""
          className={cn("sv:[-webkit-user-drag:none]", imgClassName)}
          decoding="async"
          draggable={false}
        />
      </div>
    </StudioVaaiRoot>,
    document.body,
  );
}
