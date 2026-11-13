"use client";

import type { ComponentType, ReactNode, SVGProps } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

export interface FactListItem {
  /** Leading glyph — one of the `Icon*` components, or any SVG-props component. */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  text: ReactNode;
}

export interface FactListProps {
  items: readonly FactListItem[];
  className?: string;
}

/**
 * A short icon + sentence list — the intro screen's "what happens to your photo" reassurances.
 *
 * The icons restate the sentence they sit beside rather than adding information, so they are
 * `aria-hidden` and the list reads as plain prose to assistive tech.
 */
export function FactListDefault({ items, className }: FactListProps) {
  return (
    <ul
      data-studio-vaai="fact-list"
      className={cn("sv:m-0 sv:flex sv:list-none sv:flex-col sv:gap-2 sv:p-0", className)}
    >
      {items.map(({ icon: Icon, text }, index) => (
        // Positional copy with no stable id — the index IS the key.
        // oxlint-disable-next-line no-array-index-key
        <li key={index} className="sv:flex sv:min-w-0 sv:items-start sv:gap-2.5">
          <Icon
            aria-hidden
            className="sv:mt-px sv:size-3.5 sv:shrink-0 sv:text-[var(--sv-color-muted-foreground)]"
          />
          <span className="sv:min-w-0 sv:text-[12px] sv:font-normal sv:leading-snug sv:text-[var(--sv-color-foreground-secondary)]">
            {text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FactList(props: FactListProps) {
  const Comp = useStudioVaaiUiComponent("FactList", FactListDefault);
  return <Comp {...props} />;
}
