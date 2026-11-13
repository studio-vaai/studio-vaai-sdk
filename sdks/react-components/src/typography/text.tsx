import type { HTMLAttributes, ReactNode } from "react";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../ui/cn.js";

/** Session intro legal/consent copy — beside the consent checkbox and as the legal footer line. */
export const legalTextClassName =
  "sv:m-0 sv:text-[11px] sv:font-normal sv:leading-snug sv:text-[var(--sv-color-legal)]";

/**
 * Copy roles for studio vaai sheets and flows.
 */
export const textVariants = cva("", {
  variants: {
    variant: {
      sectionLabel: "sv:m-0 sv:text-sm sv:font-medium sv:text-[var(--sv-color-foreground)]",
      body: "sv:m-0 sv:text-[14px] sv:font-normal sv:leading-[1.4] sv:tracking-normal sv:text-black",
      bodySecondary: "sv:m-0 sv:text-sm sv:text-[var(--sv-color-foreground-secondary)]",
      error: "sv:m-0 sv:text-sm sv:leading-snug sv:text-[var(--sv-color-danger)]",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

export type TextVariant = NonNullable<VariantProps<typeof textVariants>["variant"]>;

interface TextState extends Record<string, unknown> {
  variant: TextVariant;
}

export type TextProps = {
  className?: string;
  children?: ReactNode;
  /** Allows replacing the rendered `<p>` with a different element or component. */
  render?: useRender.RenderProp<TextState>;
} & VariantProps<typeof textVariants> &
  Omit<HTMLAttributes<HTMLElement>, "children">;

export function Text({ variant, className, render, children, ...props }: TextProps) {
  const state: TextState = { variant: variant ?? "body" };
  return useRender({
    render,
    state,
    defaultTagName: "p",
    props: mergeProps<"p">(
      { className: cn(textVariants({ variant }), className), children },
      props,
    ),
  });
}
