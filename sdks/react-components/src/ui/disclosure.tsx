"use client";

import * as React from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import { FROSTED_CARD_CLASS } from "./frosted-card.js";
import { IconChevronDown } from "./icons.js";

export interface DisclosureProps {
  /** Header label, left-aligned. */
  label: React.ReactNode;
  /** Optional content between the label and the chevron (e.g. the fit score percentage). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the toggle when `label` alone doesn't read as an action. */
  toggleSrLabel?: string;
  disabled?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  /** Extra attribute so screens can target a specific disclosure in tests / host CSS. */
  "data-studio-vaai"?: string;
}

/**
 * A collapsible card: a full-width header button (label · trailing · chevron) over a body
 * that expands and collapses. Used for the try-on screen's fit-score and size/color
 * sections and the intro screen's privacy card.
 *
 * The body is kept mounted and animated via `grid-template-rows: 0fr → 1fr`, which is the
 * only pure-CSS way to transition to a content-driven height — no measured pixel height to
 * go stale when the size grid rewraps or the copy relocalizes. Collapsed content is
 * `hidden` from AT and taken out of the tab order via `inert`, so a closed section can't
 * be reached by keyboard or read by a screen reader despite still being in the DOM.
 */
export function DisclosureDefault({
  label,
  trailing,
  children,
  open,
  onOpenChange,
  toggleSrLabel,
  disabled = false,
  className,
  headerClassName,
  bodyClassName,
  "data-studio-vaai": dataAttr = "disclosure",
}: DisclosureProps) {
  const bodyId = React.useId();
  return (
    <div
      data-studio-vaai={dataAttr}
      data-sv-open={open ? "" : undefined}
      className={cn(
        // The shared frosted surface. Its `shrink-0` is load-bearing HERE in particular: the body
        // sits in a `min-h-0 overflow-hidden` box (the `0fr → 1fr` animation needs that), which
        // drops this card's min-content height to just its header — so inside a height-constrained
        // flex column the parent happily shrinks it back to the header and `overflow-hidden` clips
        // the expanded content away. The card then looks like it refuses to open. Refusing to
        // shrink makes the column scroll instead.
        FROSTED_CARD_CLASS,
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={bodyId}
        {...(toggleSrLabel === undefined ? {} : { "aria-label": toggleSrLabel })}
        onClick={() => {
          onOpenChange(!open);
        }}
        className={cn(
          "sv:flex sv:w-full sv:cursor-pointer sv:appearance-none sv:items-center sv:gap-2 sv:border-0 sv:bg-transparent sv:px-3.5 sv:py-2.5 sv:text-left sv:font-sans sv:outline-none sv:disabled:cursor-default sv:focus-visible:ring-2 sv:focus-visible:ring-inset sv:focus-visible:ring-[var(--sv-color-foreground)]",
          headerClassName,
        )}
      >
        <span className="sv:min-w-0 sv:flex-1 sv:truncate sv:text-[13px] sv:font-medium sv:leading-tight sv:text-[var(--sv-color-foreground)]">
          {label}
        </span>
        {trailing}
        <IconChevronDown
          className={cn(
            "sv:size-3 sv:shrink-0 sv:text-[var(--sv-color-foreground)] sv:transition-transform sv:duration-250 sv:ease-[cubic-bezier(0.22,1,0.36,1)] sv:motion-reduce:transition-none",
            open && "sv:-rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          // Decelerating curve rather than plain ease-out: the panel arrives quickly and settles
          // softly, which reads the same whether it opens two rows or ten — the `0fr → 1fr`
          // animation takes the same time at any content height, so no screen size gets a
          // sluggish version of it.
          "sv:grid sv:transition-[grid-template-rows] sv:duration-250 sv:ease-[cubic-bezier(0.22,1,0.36,1)] sv:motion-reduce:transition-none",
          open ? "sv:grid-rows-[1fr]" : "sv:grid-rows-[0fr]",
        )}
      >
        <div
          id={bodyId}
          // `inert` also hides the subtree from AT, so no separate aria-hidden is needed.
          inert={!open}
          className={cn(
            // The height animation alone CLIPS the content — rows of chips appear mid-slice as
            // the box grows. Fading with it keeps the reveal continuous: in, just behind the
            // height so there is somewhere to arrive; out, fast, so the content is gone before
            // the clip can catch it.
            "sv:min-h-0 sv:overflow-hidden sv:transition-opacity sv:ease-out sv:motion-reduce:transition-none",
            open ? "sv:opacity-100 sv:delay-75 sv:duration-200" : "sv:opacity-0 sv:duration-100",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Disclosure(props: DisclosureProps) {
  const Comp = useStudioVaaiUiComponent("Disclosure", DisclosureDefault);
  return <Comp {...props} />;
}
