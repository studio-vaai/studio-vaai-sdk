"use client";

import type { ReactNode } from "react";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { cn } from "./cn.js";

/**
 * `startClassName` for a modal step whose `start` slot is a picture.
 *
 * The two columns already span the same band — the body's full height — but a picture is
 * sized by its own aspect, so a centred column left it floating: slack above AND below,
 * with its bottom edge landing wherever the aspect happened to put it. Screen to screen
 * that edge moved, which is what read as the dialog being differently composed on every
 * step. Flushing the picture to the FOOT of the column pins it to the one line every step
 * shares — the bottom of the CTA stack opposite — so the two columns start and end
 * together. Horizontally the column already stretches its child to the shell gutter.
 */
export const flowMediaColumnClassName = "sv:justify-end";

interface ResponsiveSplitProps {
  /** First column. Renders on the left in modal layout, on top in bottom-sheet layout. */
  start: ReactNode;
  /** Second column. Renders on the right in modal layout, below in bottom-sheet layout. */
  end: ReactNode;
  className?: string;
  startClassName?: string;
  endClassName?: string;
}

/** Two-column split that flips between row (modal) and column (drawer) based on {@link useStudioVaaiUi} `responsive.layout`. */
export function ResponsiveSplit({
  start,
  end,
  className,
  startClassName,
  endClassName,
}: ResponsiveSplitProps) {
  const { responsive } = useStudioVaaiUi();
  const isModal = responsive.layout === "modal";
  return (
    <div
      className={cn(
        "sv:flex sv:min-h-0 sv:w-full sv:flex-1",
        isModal ? "sv:flex-row sv:gap-8" : "sv:flex-col sv:gap-4",
        className,
      )}
    >
      <div
        className={cn(
          "sv:min-h-0 sv:min-w-0 sv:flex sv:flex-col sv:justify-center",
          isModal && "sv:flex-1",
          startClassName,
        )}
      >
        {start}
      </div>
      <div
        className={cn(
          "sv:min-h-0 sv:min-w-0 sv:flex sv:flex-col sv:justify-center",
          isModal && "sv:flex-1",
          endClassName,
        )}
      >
        {end}
      </div>
    </div>
  );
}
