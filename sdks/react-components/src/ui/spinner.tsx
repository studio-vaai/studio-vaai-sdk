"use client";

import type { HTMLAttributes, ReactNode } from "react";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Screen reader status (e.g. upload vs try-on in flight). */
  label: string;
  /** Allows replacing the rendered `<span>` with a different element or component. */
  render?: useRender.RenderProp<Record<string, never>>;
}

export function SpinnerDefault({ label, className, render, ...props }: SpinnerProps): ReactNode {
  return useRender({
    render,
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        role: "status" as const,
        "aria-live": "polite" as const,
        className: cn(
          "sv:inline-flex sv:shrink-0 sv:items-center sv:justify-center sv:gap-2",
          className,
        ),
        children: (
          <>
            {/* `size-[1em]` is a floor, not decoration: the SVG carries a viewBox and no width or
                height, and the SDK ships Tailwind WITHOUT preflight, so nothing else gives it an
                intrinsic size. A caller that passed no size class rendered a 0x0 spinner — which
                is how the photo-capture upload state ended up with no visible indicator at all.
                Sizing in `em` keeps a caller's own size class (or font-size) in charge. */}
            <svg
              aria-hidden
              className="sv:size-[1em] sv:shrink-0"
              data-studio-vaai="spinner"
              viewBox="0 0 24 24"
            >
              <g>
                <animateTransform
                  attributeName="transform"
                  dur="1s"
                  from="0 12 12"
                  repeatCount="indefinite"
                  to="360 12 12"
                  type="rotate"
                />
                <circle
                  cx="12"
                  cy="12"
                  fill="none"
                  r="10"
                  // `currentColor`, so a caller can recolour it — on the capture overlay the
                  // secondary-foreground grey was invisible against the dark scrim.
                  stroke="currentColor"
                  strokeDasharray="47 16"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </g>
            </svg>
            <span className="sv:sr-only">{label}</span>
          </>
        ),
      },
      props,
    ),
  });
}

export function Spinner(props: SpinnerProps): ReactNode {
  const Comp = useStudioVaaiUiComponent("Spinner", SpinnerDefault);
  return <Comp {...props} />;
}
