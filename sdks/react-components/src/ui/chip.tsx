"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

interface ChipState extends Record<string, unknown> {
  selected: boolean;
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this chip represents the currently selected value. Drives both visuals and `aria-pressed`. */
  selected?: boolean;
  /** Allows replacing the rendered `<button>` with a different element or component. */
  render?: useRender.RenderProp<ChipState>;
}

const chipBase =
  "sv:inline-flex sv:items-center sv:justify-center sv:min-w-[2.75rem] sv:appearance-none sv:rounded-md sv:border sv:px-3 sv:py-2.5 sv:font-sans sv:text-lg sv:font-medium sv:whitespace-nowrap sv:transition-colors sv:focus-visible:outline-none sv:focus-visible:ring-2 sv:focus-visible:ring-offset-2 sv:disabled:pointer-events-none sv:disabled:opacity-40";

const chipInactive =
  "sv:border-[var(--sv-color-border)] sv:bg-[var(--sv-color-bg)] sv:text-[var(--sv-color-foreground)] sv:hover:border-[var(--sv-color-border-strong)]";

const chipActive = "sv:border-black sv:bg-black sv:text-white";

export const ChipDefault = React.forwardRef<HTMLButtonElement, ChipProps>(function ChipDefault(
  { className, selected = false, type: _type, render, ...props },
  ref,
) {
  const state: ChipState = { selected };
  return useRender({
    render,
    ref,
    state,
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        "aria-pressed": selected,
        className: cn(chipBase, selected ? chipActive : chipInactive, className),
      },
      props,
    ),
  });
});

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(props, ref) {
  const Comp = useStudioVaaiUiComponent("Chip", ChipDefault);
  return <Comp ref={ref} {...props} />;
});
