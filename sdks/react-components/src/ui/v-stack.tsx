"use client";

import type { HTMLAttributes, ReactNode } from "react";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

const gapClass = {
  sm: "sv:gap-2",
  md: "sv:gap-4",
  lg: "sv:gap-6",
} as const;

export type VStackGap = keyof typeof gapClass;

interface VStackState extends Record<string, unknown> {
  gap: VStackGap;
}

export interface VStackProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  gap?: VStackGap;
  /** Allows replacing the rendered `<div>` with a different element or component. */
  render?: useRender.RenderProp<VStackState>;
}

export function VStackDefault({ gap = "md", className, children, render, ...props }: VStackProps) {
  const state: VStackState = { gap };
  return useRender({
    render,
    state,
    defaultTagName: "div",
    props: mergeProps<"div">(
      { className: cn("sv:flex sv:flex-col", gapClass[gap], className), children },
      props,
    ),
  });
}

export function VStack({ gap = "md", className, children, ...props }: VStackProps) {
  const Comp = useStudioVaaiUiComponent("VStack", VStackDefault);
  return (
    <Comp gap={gap} className={className} {...props}>
      {children}
    </Comp>
  );
}
