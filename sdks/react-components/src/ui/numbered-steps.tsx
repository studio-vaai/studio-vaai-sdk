"use client";

import type { ReactNode } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

export interface NumberedStepsProps {
  /** Steps in order; the index drives the printed number. */
  steps: readonly ReactNode[];
  className?: string;
}

/**
 * The intro screen's "how this works" list: a filled counter disc per step beside its label.
 *
 * Rendered as an `<ol>` so assistive tech reads it as an ordered sequence; the discs are
 * decorative duplicates of the list's own numbering and are hidden from AT to avoid
 * "one one, two two".
 */
export function NumberedStepsDefault({ steps, className }: NumberedStepsProps) {
  return (
    <ol
      data-studio-vaai="numbered-steps"
      className={cn("sv:m-0 sv:flex sv:list-none sv:flex-col sv:gap-2.5 sv:p-0", className)}
    >
      {steps.map((step, index) => (
        // Steps are positional copy with no stable id of their own, so the index IS the key.
        // oxlint-disable-next-line no-array-index-key
        <li key={index} className="sv:flex sv:min-w-0 sv:items-center sv:gap-2.5">
          <span
            aria-hidden
            className="sv:inline-flex sv:size-5 sv:shrink-0 sv:items-center sv:justify-center sv:rounded-full sv:bg-[var(--sv-color-primary)] sv:text-[11px] sv:font-medium sv:leading-none sv:text-[var(--sv-color-on-primary)]"
          >
            {index + 1}
          </span>
          <span className="sv:min-w-0 sv:text-[13px] sv:font-normal sv:leading-snug sv:text-[var(--sv-color-foreground)]">
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function NumberedSteps(props: NumberedStepsProps) {
  const Comp = useStudioVaaiUiComponent("NumberedSteps", NumberedStepsDefault);
  return <Comp {...props} />;
}
