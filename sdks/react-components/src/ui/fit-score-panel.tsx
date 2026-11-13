"use client";

import type { ReactNode } from "react";

import { useStudioVaaiUiMessages } from "../i18n/context.js";
import { formatPercent } from "../i18n/number-format.js";
import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import { fitScoreGradient } from "./fit-score-ramp.js";
import { IconAlertCircle, IconChevronDown, IconRetry } from "./icons.js";

export interface FitScorePanelProps {
  /** Section label, e.g. "Fit Score". */
  label: ReactNode;
  /** 0–100, already rounded and clamped by the caller. */
  pct: number;
  /**
   * The expanded body: the garment's intended fit in a sentence. Omit to render a panel that
   * has nothing to expand into — the toggle is then hidden and only the collapsed bar shows.
   */
  detail?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the toggle (the visible label is a heading, not an action). */
  toggleSrLabel: string;
  className?: string;
}

/**
 * The try-on screen's fit-score ribbon. Collapsed it is a slim bar — label, percentage,
 * chevron. Expanded it grows into a card that keeps the percentage as the dominant number
 * and adds the intended-fit sentence beside it.
 *
 * Both states are one `<button>`, so the whole ribbon is the toggle rather than just the
 * chevron; it carries `aria-expanded` and owns the body by id.
 */
export function FitScorePanelDefault({
  label,
  pct,
  detail,
  open,
  onOpenChange,
  toggleSrLabel,
  className,
}: FitScorePanelProps) {
  const expandable = detail !== undefined;
  const expanded = expandable && open;
  const { locale } = useStudioVaaiUiMessages();
  const pctText = formatPercent(locale, pct);
  return (
    <button
      type="button"
      data-studio-vaai="try-on-fit-score"
      data-sv-open={expanded ? "" : undefined}
      aria-expanded={expandable ? expanded : undefined}
      aria-label={toggleSrLabel}
      disabled={!expandable}
      onClick={() => {
        onOpenChange(!open);
      }}
      style={{ backgroundImage: fitScoreGradient(pct) }}
      className={cn(
        // `shrink-0` for the same reason as `Disclosure`: the expandable detail lives in a
        // `min-h-0 overflow-hidden` box, so a constrained flex column would otherwise squash
        // this back to its collapsed height and clip the detail.
        "sv:flex sv:min-w-0 sv:max-w-full sv:shrink-0 sv:cursor-pointer sv:appearance-none sv:items-center sv:gap-3 sv:overflow-hidden sv:rounded-[var(--sv-radius-control)] sv:border-0 sv:px-3.5 sv:text-left sv:font-sans sv:outline-none sv:backdrop-blur-[2px] sv:transition-[padding] sv:duration-200 sv:focus-visible:ring-2 sv:focus-visible:ring-inset sv:focus-visible:ring-[var(--sv-color-foreground)] sv:disabled:cursor-default",
        expanded ? "sv:py-3" : "sv:py-2.5",
        className,
      )}
    >
      <span className="sv:flex sv:min-w-0 sv:flex-1 sv:flex-col sv:gap-1">
        <span className="sv:truncate sv:text-[14px] sv:font-medium sv:leading-tight sv:text-[var(--sv-color-foreground)]">
          {label}
        </span>
        {/* Same `0fr → 1fr` grid trick as `Disclosure`: animates to a content-driven
            height, and `inert` keeps the collapsed sentence out of AT and the tab order. */}
        {expandable ? (
          <span
            className={cn(
              "sv:grid sv:transition-[grid-template-rows] sv:duration-250 sv:ease-out",
              expanded ? "sv:grid-rows-[1fr]" : "sv:grid-rows-[0fr]",
            )}
          >
            <span inert={!expanded} className="sv:min-h-0 sv:overflow-hidden">
              <span className="sv:block sv:text-[14px] sv:font-normal sv:leading-snug sv:text-[var(--sv-color-foreground)]">
                {detail}
              </span>
            </span>
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "sv:shrink-0 sv:leading-none sv:text-[var(--sv-color-foreground)] sv:transition-[font-size] sv:duration-200",
          expanded ? "sv:text-[40px] sv:font-medium" : "sv:text-[16px] sv:font-semibold",
        )}
      >
        {pctText}
      </span>
      {expandable ? (
        <IconChevronDown
          className={cn(
            "sv:size-3 sv:shrink-0 sv:self-start sv:text-[var(--sv-color-foreground)] sv:transition-transform sv:duration-200",
            !expanded && "sv:-rotate-180",
          )}
        />
      ) : null}
    </button>
  );
}

export function FitScorePanel(props: FitScorePanelProps) {
  const Comp = useStudioVaaiUiComponent("FitScorePanel", FitScorePanelDefault);
  return <Comp {...props} />;
}

export interface FitScoreUnavailableProps {
  /** What went wrong, in one line — e.g. "Fit score unavailable". */
  label: ReactNode;
  /** Retry handler. Omit to render the bar without a retry control. */
  onRetry?: () => void;
  /** Accessible name for the retry control. */
  retrySrLabel: string;
  /** Disables the retry control while a request is already in flight. */
  busy?: boolean;
  className?: string;
}

/**
 * Stands in for {@link FitScorePanel} when the recommendation request failed. Deliberately
 * occupies the same slot and height as the ribbon rather than disappearing: the shopper has
 * a try-on on screen either way, and a silently-missing score reads as "this garment has no
 * fit data" instead of "we couldn't reach the service, try again".
 */
export function FitScoreUnavailableDefault({
  label,
  onRetry,
  retrySrLabel,
  busy = false,
  className,
}: FitScoreUnavailableProps) {
  return (
    <div
      role="status"
      data-studio-vaai="try-on-fit-score-unavailable"
      className={cn(
        // `max-w-full`, not `w-full`: the flex parent already stretches this to the column
        // width, and an explicit 100% resolves against the padding box — which is a hair wider
        // than the stretched siblings once a scrollbar is in play, and pushed the retry control
        // past the edge.
        "sv:flex sv:min-w-0 sv:max-w-full sv:items-center sv:gap-2 sv:rounded-[var(--sv-radius-control)] sv:bg-[var(--sv-color-overlay-card)] sv:px-3.5 sv:py-2.5 sv:backdrop-blur-md",
        className,
      )}
    >
      <IconAlertCircle
        aria-hidden
        className="sv:size-3.5 sv:shrink-0 sv:text-[var(--sv-color-danger)]"
      />
      <span className="sv:min-w-0 sv:flex-1 sv:truncate sv:text-[13px] sv:font-normal sv:leading-tight sv:text-[var(--sv-color-foreground)]">
        {label}
      </span>
      {onRetry === undefined ? null : (
        <button
          type="button"
          aria-label={retrySrLabel}
          disabled={busy}
          onClick={onRetry}
          className="sv:inline-flex sv:size-6 sv:shrink-0 sv:cursor-pointer sv:appearance-none sv:items-center sv:justify-center sv:rounded-full sv:border-0 sv:bg-transparent sv:p-0 sv:text-[var(--sv-color-foreground)] sv:outline-none sv:hover:opacity-70 sv:focus-visible:ring-2 sv:focus-visible:ring-[var(--sv-color-foreground)] sv:disabled:cursor-default sv:disabled:opacity-40"
        >
          <IconRetry className="sv:size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FitScoreUnavailable(props: FitScoreUnavailableProps) {
  const Comp = useStudioVaaiUiComponent("FitScoreUnavailable", FitScoreUnavailableDefault);
  return <Comp {...props} />;
}
