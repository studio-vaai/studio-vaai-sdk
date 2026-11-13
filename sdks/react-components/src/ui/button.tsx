"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { cn } from "./cn.js";
import { Spinner } from "./spinner.js";

const buttonVariants = cva(
  // `font-sans` is required because <button> doesn't inherit font-family from
  // its parents — without it the UA stylesheet falls through to Arial.
  // The `aria-disabled:` variants mirror the native `disabled:` dimming for the
  // "always-enabled, explain-on-click" CTAs (which carry `aria-disabled` instead
  // of the native attribute) — same look as a genuinely disabled button, minus
  // `pointer-events-none` so the click still reaches `onClickDisabled`.
  "sv:inline-flex sv:items-center sv:justify-center sv:gap-2 sv:whitespace-nowrap sv:border-0 sv:font-sans sv:text-sm sv:font-medium sv:appearance-none sv:transition-colors sv:focus-visible:outline-none sv:focus-visible:ring-2 sv:focus-visible:ring-offset-2 sv:disabled:pointer-events-none sv:disabled:opacity-40 sv:aria-disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "sv:flex sv:min-h-[48px] sv:w-full sv:shrink-0 sv:items-center sv:justify-center sv:rounded-[var(--sv-radius-button-primary)] sv:bg-black sv:px-4 sv:py-3 sv:text-[15px] sv:font-normal sv:leading-tight sv:text-white sv:disabled:cursor-not-allowed sv:aria-disabled:cursor-not-allowed",
        ghost:
          "sv:w-full sv:bg-transparent sv:py-1 sv:text-center sv:text-[14px] sv:font-normal sv:text-[var(--sv-color-foreground)] sv:outline-none",
        linkAccent:
          "sv:inline-flex sv:items-center sv:gap-1.5 sv:bg-transparent sv:p-0 sv:text-sm sv:font-medium sv:text-[var(--sv-color-link)] sv:outline-none sv:hover:text-[var(--sv-color-link-hover)]",
        icon: "sv:inline-flex sv:h-10 sv:w-10 sv:shrink-0 sv:items-center sv:justify-center sv:appearance-none sv:border-0 sv:bg-transparent sv:p-0 sv:text-black sv:rounded-none sv:outline-none sv:focus:outline-none sv:focus-visible:outline-none sv:focus-visible:ring-0 sv:focus-visible:ring-offset-0 sv:hover:opacity-70 sv:active:opacity-50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface ButtonState extends Record<string, unknown> {
  busy: boolean;
}

/**
 * Props the rendered button component receives — the built-in {@link ButtonDefault}
 * or any override registered via `useStudioVaaiUiComponent`. The {@link Button}
 * wrapper has already resolved the "always-enabled, explain-on-click" pattern into
 * a plain native `disabled`, a pre-routed `onClick`, and `aria-disabled`, so the
 * rendered component never sees `onClickDisabled` — it just renders what it's given
 * and inherits the behavior for free.
 */
export interface ButtonRenderProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /**
   * When `true`, the button is in an in-flight state: it disables itself, sets `aria-busy="true"`,
   * announces `busyLabel` to screen readers (as the button's accessible name), and overlays a spinner
   * over the (still-laid-out) children so the rendered width does not change.
   */
  busy?: boolean;
  /**
   * Screen-reader announcement while `busy` is true (e.g. "Saving height…"). Becomes the button's
   * `aria-label` during the busy state so the original text — which is hidden from AT — isn't read.
   */
  busyLabel?: string;
  /** Allows replacing the rendered `<button>` with a different element or component. */
  render?: useRender.RenderProp<ButtonState>;
}

/** Public props for {@link Button}. Adds the wrapper-only explain-on-click handler. */
export interface ButtonProps extends ButtonRenderProps {
  /**
   * Opt into the "always-enabled, explain-on-click" pattern. Providing this
   * handler keeps the button clickable even while it's not actionable (`disabled`
   * precondition unmet, or `busy`) — it's never given the native `disabled`
   * attribute (which would swallow the click), just `aria-disabled`. Any click
   * while not actionable routes here instead of `onClick`, so the real action
   * never double-fires. Wire it to surface an error
   * (e.g. `onClickDisabled={() => setReason("consentRequired")}`); when the
   * precondition is actually met the reason resolves and nothing shows.
   *
   * Resolved entirely in the {@link Button} wrapper, above the override boundary:
   * the rendered component (default or override) only ever receives the resulting
   * native `disabled`, pre-routed `onClick`, and `aria-disabled` (see
   * {@link ButtonRenderProps}). This is a wrapper-only prop by design.
   */
  onClickDisabled?: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * Modal-layout overrides for the primary/secondary CTAs. Desktop Figma uses a
 * pill-shaped, compact button instead of the full-width tap target the bottom
 * sheet needs on touch. `cn` runs `tailwind-merge`, so these win over the
 * variant defaults.
 */
const modalDefaultOverride =
  "sv:flex sv:min-h-[36px] sv:w-auto sv:shrink-0 sv:rounded-full sv:px-8 sv:py-2 sv:text-[14px] sv:font-medium sv:leading-none";

const modalGhostOverride =
  "sv:flex sv:min-h-[36px] sv:w-auto sv:shrink-0 sv:items-center sv:justify-center sv:rounded-full sv:border sv:border-[var(--sv-color-foreground)] sv:bg-transparent sv:px-8 sv:py-2 sv:text-[14px] sv:font-medium sv:leading-none sv:text-[var(--sv-color-foreground)]";

function resolveModalOverride(
  variant: ButtonProps["variant"],
  layout: "bottomSheet" | "modal",
): string {
  if (layout !== "modal") {
    return "";
  }
  if (variant === "ghost") {
    return modalGhostOverride;
  }
  if (variant === undefined || variant === "default") {
    return modalDefaultOverride;
  }
  return "";
}

export const ButtonDefault = React.forwardRef<HTMLButtonElement, ButtonRenderProps>(
  (
    {
      className,
      variant,
      type,
      busy = false,
      busyLabel,
      disabled,
      onClick,
      children,
      "aria-label": ariaLabel,
      render,
      ...props
    },
    ref,
  ) => {
    const { responsive } = useStudioVaaiUi();
    const modalOverride = resolveModalOverride(variant, responsive.layout);
    const mergedClassName = cn(buttonVariants({ variant }), modalOverride, className);
    // The "always-enabled, explain-on-click" routing — native `disabled`,
    // `onClick`, and `aria-disabled` — is resolved upstream in the `Button`
    // wrapper, so this component (and any override) just renders what it's given.
    // While busy:
    // - Children stay in the layout flow with `visibility: hidden` so the button's
    //   intrinsic width does not collapse to spinner size (CSS-only size lock).
    // - The spinner is placed in the same grid cell via `grid-area: 1 / 1` and is
    //   only present in the DOM during the busy state.
    // - AT announces `busyLabel` instead of the original text; children + spinner
    //   are both `aria-hidden` so they don't double-read.
    const content = (
      <span data-studio-vaai="button-content" className="sv:grid sv:place-items-center sv:gap-0">
        <span
          className={cn(
            "sv:col-start-1 sv:row-start-1 sv:inline-flex sv:items-center sv:justify-center sv:gap-2",
            busy && "sv:invisible",
          )}
          aria-hidden={busy || undefined}
        >
          {children}
        </span>
        {busy ? (
          <Spinner
            className="sv:size-[1.4em] sv:col-start-1 sv:row-start-1 sv:text-[var(--sv-color-foreground-secondary)]"
            label={busyLabel ?? ""}
            aria-hidden
          />
        ) : null}
      </span>
    );
    let resolvedType: "submit" | "reset" | "button" = "button";
    if (type === "submit") {
      resolvedType = "submit";
    } else if (type === "reset") {
      resolvedType = "reset";
    }
    const state: ButtonState = { busy };
    return useRender({
      render,
      ref,
      state,
      defaultTagName: "button",
      props: mergeProps<"button">(
        {
          type: resolvedType,
          className: mergedClassName,
          disabled,
          onClick,
          // `aria-disabled` (when the wrapper routed an explain-on-click button)
          // flows through `props` below.
          "aria-busy": busy || undefined,
          "aria-label": busy ? busyLabel : ariaLabel,
          children: content,
        },
        props,
      ),
    });
  },
);
ButtonDefault.displayName = "Button";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { onClickDisabled, onClick, disabled, busy = false, ...rest },
  ref,
) {
  const Comp = useStudioVaaiUiComponent("Button", ButtonDefault);
  // "Always-enabled, explain-on-click" routing lives here — above the override
  // boundary — so override components inherit it for free. When `onClickDisabled`
  // is wired we never set the native `disabled` attribute (a native-disabled
  // <button> swallows the click, so the message would never fire). Instead the
  // button stays clickable but is marked `aria-disabled`, and any click while
  // it's not actionable (precondition unmet OR busy) routes to `onClickDisabled`
  // rather than the real `onClick`. Buttons without `onClickDisabled` (back/close,
  // etc.) fall back to plain native `disabled`. `onClickDisabled` is consumed here
  // and never forwarded — the rendered component (default or override) receives
  // only the resolved `disabled` / `onClick` / `aria-disabled` (ButtonRenderProps).
  const explainOnClick = onClickDisabled !== undefined;
  const notActionable = disabled === true || busy;
  const nativeDisabled = explainOnClick ? false : notActionable;
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (notActionable) {
      // Never fire the real action while blocked/busy (prevents double-submit).
      if (explainOnClick) {
        event.preventDefault();
        onClickDisabled(event);
      }
      return;
    }
    onClick?.(event);
  };
  return (
    <Comp
      ref={ref}
      {...rest}
      busy={busy}
      disabled={nativeDisabled}
      onClick={handleClick}
      aria-disabled={(explainOnClick && notActionable) || undefined}
    />
  );
});
Button.displayName = "Button";

/**
 * Full-width rectangular CTAs for flow steps that stack their actions inside a column rather
 * than in the shell footer — the modal's default pill would fight the card it sits under, and
 * the design draws these as blocks. `min-w-0` + `whitespace-normal` matter: `buttonVariants`
 * sets `whitespace-nowrap`, so a long localized label would otherwise give the button a
 * min-content width wider than its column and force a horizontal scrollbar.
 *
 * `cn` runs `tailwind-merge` (prefix-aware), so these win over the variant defaults.
 */
export const flowPrimaryCtaClassName =
  "sv:w-full sv:min-w-0 sv:min-h-[48px] sv:whitespace-normal sv:rounded-[var(--sv-radius-control)] sv:px-4 sv:text-[15px] sv:font-medium";

export const flowSecondaryCtaClassName =
  "sv:w-full sv:min-w-0 sv:min-h-0 sv:whitespace-normal sv:rounded-none sv:border-0 sv:bg-transparent sv:px-0 sv:py-1 sv:text-[15px] sv:font-normal";

export { buttonVariants };
