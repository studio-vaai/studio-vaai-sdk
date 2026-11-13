"use client";

import type { ReactNode } from "react";

import { useErrorContext } from "../error/error-context.js";
import { Text } from "../typography/text.js";
import { cn } from "./cn.js";
import { IconAlertCircle } from "./icons.js";

/** Hoisted so the card variant doesn't hand `Text` a fresh element every render. */
const renderSpan = <span />;

interface ErrorMessageProps {
  /**
   * Explicit message to render. When omitted, the current error is read from the
   * {@link useErrorContext | error context} — the default for the always-enabled
   * CTA pattern. Pass children only for status screens that own their own error
   * text (e.g. camera permission states) but want the shared markup/styling.
   */
  children?: ReactNode;
  /**
   * Force a treatment. Normally leave this unset: the error itself says whether it is a nudge
   * answering a click (a plain red line under the control) or a failure that stops the screen
   * (a boxed card), and every screen should draw the same kind the same way. Pass it only where
   * there is no derived error to read (a screen supplying its own `children`), or where a
   * screen deliberately departs from it — the try-on view keeps failures inline because it is
   * already a stack of cards over a photo.
   */
  variant?: "inline" | "card";
  className?: string;
}

/**
 * The single error-message component for the flow. Renders with `role="alert"`, sourcing the
 * message from the error context (or explicit children). Self-hides when there's nothing to show.
 */
export function ErrorMessage({ children, variant, className }: ErrorMessageProps): ReactNode {
  const { error } = useErrorContext();
  const message = children ?? error?.message;
  if (message === undefined || message === null || message === false) {
    return null;
  }
  // The error's own kind decides, unless a caller overrode it. A failure is boxed; an
  // interaction nudge is a line. Screens no longer choose per call site, which is how a system
  // error on the size step ended up drawn as a bare red footnote.
  const resolved = variant ?? (error?.kind === "failure" ? "card" : "inline");
  if (resolved === "card") {
    return (
      <div
        role="alert"
        data-studio-vaai="error-card"
        className={cn(
          // Sampled from the reference: a soft red rule and glyph, but the COPY is dark on a
          // plain surface. Red text inside a red-tinted box read as an alarm; these are
          // recoverable states with a retry right underneath, and the reference tones them
          // accordingly — the border carries the severity, the sentence just explains.
          "sv:flex sv:items-start sv:gap-2.5 sv:rounded-[var(--sv-radius-control)] sv:border sv:border-[var(--sv-color-danger)]/65 sv:bg-[var(--sv-color-surface)] sv:px-3.5 sv:py-3",
          className,
        )}
      >
        <IconAlertCircle
          aria-hidden
          className="sv:mt-px sv:size-4 sv:shrink-0 sv:text-[var(--sv-color-danger)]"
        />
        <Text
          render={renderSpan}
          className="sv:min-w-0 sv:flex-1 sv:text-[13px] sv:leading-snug sv:text-[var(--sv-color-foreground)]"
        >
          {message}
        </Text>
      </div>
    );
  }
  // Inline still carries the alert glyph — the reference draws one beside "Anprobe in 28/32
  // fehlgeschlagen" — so red text is never the only thing marking a failure. That matters for
  // anyone who cannot separate this red from the surrounding copy.
  return (
    <Text
      variant="error"
      role="alert"
      render={renderSpan}
      className={cn("sv:flex sv:items-start sv:gap-1.5", className)}
    >
      <IconAlertCircle aria-hidden className="sv:mt-0.5 sv:size-3.5 sv:shrink-0" />
      <span className="sv:min-w-0 sv:flex-1">{message}</span>
    </Text>
  );
}
