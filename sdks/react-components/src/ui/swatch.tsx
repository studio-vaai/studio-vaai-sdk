"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

interface SwatchState extends Record<string, unknown> {
  selected: boolean;
}

export interface SwatchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this swatch represents the currently selected value. Drives both visuals and `aria-pressed`. */
  selected?: boolean;
  /** Allows replacing the rendered `<button>` with a different element or component. */
  render?: useRender.RenderProp<SwatchState>;
}

const swatchBase =
  "sv:inline-flex sv:h-8 sv:w-8 sv:shrink-0 sv:appearance-none sv:rounded-full sv:border-2 sv:p-0 sv:transition-shadow sv:focus-visible:outline-none sv:focus-visible:ring-2 sv:focus-visible:ring-offset-2 sv:disabled:pointer-events-none sv:disabled:opacity-40";

const swatchInactive = "sv:border-[var(--sv-color-border)]";

const swatchActive = "sv:border-black sv:ring-2 sv:ring-black sv:ring-offset-1";

export const SwatchDefault = React.forwardRef<HTMLButtonElement, SwatchProps>(
  function SwatchDefault({ className, selected = false, type: _type, render, ...props }, ref) {
    const state: SwatchState = { selected };
    return useRender({
      render,
      ref,
      state,
      defaultTagName: "button",
      props: mergeProps<"button">(
        {
          type: "button",
          "aria-pressed": selected,
          className: cn(swatchBase, selected ? swatchActive : swatchInactive, className),
        },
        props,
      ),
    });
  },
);

export const Swatch = React.forwardRef<HTMLButtonElement, SwatchProps>(function Swatch(props, ref) {
  const Comp = useStudioVaaiUiComponent("Swatch", SwatchDefault);
  return <Comp ref={ref} {...props} />;
});
