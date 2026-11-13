"use client";

import { Drawer } from "@base-ui/react/drawer";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import * as React from "react";

import type { SheetShellClassNames } from "./sheet-shell-class-names.js";

import { useStudioVaaiUiMessages } from "../i18n/context.js";
import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiTheme } from "../theme-context.js";
import { Button } from "./button.js";
import { cn } from "./cn.js";
import { IconBack, IconClose } from "./icons.js";
import { StudioVaaiRoot } from "./studio-vaai-root.js";

/** Bottom sheet built on Base UI [Drawer](https://base-ui.com/react/components/drawer) (modal, swipe to dismiss). */
export function BottomSheetDefault(props: React.ComponentProps<typeof Drawer.Root>) {
  return <Drawer.Root swipeDirection="down" {...props} />;
}

export function BottomSheet(props: React.ComponentProps<typeof Drawer.Root>) {
  const Comp = useStudioVaaiUiComponent("BottomSheet", BottomSheetDefault);
  return <Comp {...props} />;
}

function BottomSheetPortalImpl({ children, ...props }: React.ComponentProps<typeof Drawer.Portal>) {
  // Portal children render into `document.body`, outside the provider's
  // `#studio-vaai-root` ancestor — re-establish it (and re-apply the `theme`
  // tokens, which don't cross the DOM portal boundary) so prefixed Tailwind matches.
  const theme = useStudioVaaiTheme();
  return (
    <Drawer.Portal {...props}>
      <StudioVaaiRoot tokens={theme}>{children}</StudioVaaiRoot>
    </Drawer.Portal>
  );
}

export function BottomSheetPortalDefault(props: React.ComponentProps<typeof Drawer.Portal>) {
  const Comp = useStudioVaaiUiComponent("BottomSheetPortal", BottomSheetPortalImpl);
  return <Comp {...props} />;
}

export function BottomSheetPortal(props: React.ComponentProps<typeof Drawer.Portal>) {
  return <BottomSheetPortalDefault {...props} />;
}

function BottomSheetDescriptionImpl(props: React.ComponentProps<typeof Drawer.Description>) {
  return <Drawer.Description {...props} />;
}

export function BottomSheetDescriptionDefault(
  props: React.ComponentProps<typeof Drawer.Description>,
) {
  const Comp = useStudioVaaiUiComponent("BottomSheetDescription", BottomSheetDescriptionImpl);
  return <Comp {...props} />;
}

export function BottomSheetDescription(props: React.ComponentProps<typeof Drawer.Description>) {
  return <BottomSheetDescriptionDefault {...props} />;
}

function BottomSheetTriggerImpl(props: React.ComponentProps<typeof Drawer.Trigger>) {
  return <Drawer.Trigger {...props} />;
}

export function BottomSheetTriggerDefault(props: React.ComponentProps<typeof Drawer.Trigger>) {
  const Comp = useStudioVaaiUiComponent("BottomSheetTrigger", BottomSheetTriggerImpl);
  return <Comp {...props} />;
}

export function BottomSheetTrigger(props: React.ComponentProps<typeof Drawer.Trigger>) {
  return <BottomSheetTriggerDefault {...props} />;
}

function BottomSheetCloseImpl(props: React.ComponentProps<typeof Drawer.Close>) {
  return <Drawer.Close {...props} />;
}

export function BottomSheetCloseDefault(props: React.ComponentProps<typeof Drawer.Close>) {
  const Comp = useStudioVaaiUiComponent("BottomSheetClose", BottomSheetCloseImpl);
  return <Comp {...props} />;
}

export function BottomSheetClose(props: React.ComponentProps<typeof Drawer.Close>) {
  return <BottomSheetCloseDefault {...props} />;
}

const bottomSheetViewportVariants = cva(
  "sv:pointer-events-none sv:fixed sv:inset-0 sv:z-50 sv:flex sv:max-h-full sv:flex-col sv:justify-end",
);

const bottomSheetBackdropVariants = cva(
  "sv-sheet-backdrop sv:fixed sv:inset-0 sv:z-40 sv:bg-[var(--sv-color-overlay)]",
);

const bottomSheetContentVariants = cva(
  "sv-sheet-content sv:pointer-events-auto sv:box-border sv:z-50 sv:flex sv:min-h-0 sv:flex-col sv:h-auto sv:w-full sv:relative sv:rounded-t-[var(--sv-radius-sheet)] sv:bg-[var(--sv-color-surface)] sv:shadow-[0_-4px_24px_rgba(0,0,0,0.1)] sv:outline-none",
);

export type BottomSheetBackdropProps = React.ComponentPropsWithoutRef<typeof Drawer.Backdrop>;

const BottomSheetBackdropImpl = React.forwardRef<HTMLDivElement, BottomSheetBackdropProps>(
  function BottomSheetBackdropImpl({ className, ...props }, ref) {
    return (
      <Drawer.Backdrop
        ref={ref}
        className={cn(bottomSheetBackdropVariants(), className)}
        {...props}
      />
    );
  },
);

/** Stable no-op default for the {@link SheetDebugButton} override slot. */
function NullDebugButton(): null {
  return null;
}

export const BottomSheetBackdropDefault = React.forwardRef<
  HTMLDivElement,
  BottomSheetBackdropProps
>(function BottomSheetBackdropDefault({ className, ...props }, ref) {
  const Comp = useStudioVaaiUiComponent("BottomSheetBackdrop", BottomSheetBackdropImpl);
  const DebugButton = useStudioVaaiUiComponent("SheetDebugButton", NullDebugButton);
  return (
    <>
      <Comp ref={ref} className={className} {...props} />
      <div className="sv:fixed sv:top-4 sv:right-4 sv:z-50 sv:pointer-events-auto" aria-hidden>
        <DebugButton />
      </div>
    </>
  );
});
BottomSheetBackdropDefault.displayName = "BottomSheetBackdrop";

export const BottomSheetBackdrop = React.forwardRef<HTMLDivElement, BottomSheetBackdropProps>(
  function BottomSheetBackdrop(props, ref) {
    return <BottomSheetBackdropDefault {...props} ref={ref} />;
  },
);
BottomSheetBackdrop.displayName = "BottomSheetBackdrop";

export type BottomSheetViewportProps = React.ComponentPropsWithoutRef<typeof Drawer.Viewport>;

const BottomSheetViewportImpl = React.forwardRef<HTMLDivElement, BottomSheetViewportProps>(
  function BottomSheetViewportImpl({ className, ...props }, ref) {
    return (
      <Drawer.Viewport
        ref={ref}
        className={cn(bottomSheetViewportVariants(), className)}
        {...props}
      />
    );
  },
);

export const BottomSheetViewportDefault = React.forwardRef<
  HTMLDivElement,
  BottomSheetViewportProps
>(function BottomSheetViewportDefault({ className, ...props }, ref) {
  const Comp = useStudioVaaiUiComponent("BottomSheetViewport", BottomSheetViewportImpl);
  return <Comp ref={ref} className={className} {...props} />;
});
BottomSheetViewportDefault.displayName = "BottomSheetViewport";

export const BottomSheetViewport = React.forwardRef<HTMLDivElement, BottomSheetViewportProps>(
  function BottomSheetViewport(props, ref) {
    return <BottomSheetViewportDefault {...props} ref={ref} />;
  },
);
BottomSheetViewport.displayName = "BottomSheetViewport";

/** Styled `Drawer.Popup` — the sliding panel shell (not Base UI `Drawer.Content`, which is for scroll regions). */
export type BottomSheetContentProps = React.ComponentPropsWithoutRef<typeof Drawer.Popup>;

const BottomSheetContentImpl = React.forwardRef<HTMLDivElement, BottomSheetContentProps>(
  function BottomSheetContentImpl({ className, children, ...props }, ref) {
    return (
      <Drawer.Popup ref={ref} className={cn(bottomSheetContentVariants(), className)} {...props}>
        {children}
        {/* Fills the gap that appears below the panel when overscrolling upward */}
        <div
          aria-hidden
          className="sv:absolute sv:inset-x-0 sv:top-[calc(100%-1px)] sv:h-[200px] sv:bg-[var(--sv-color-surface)] sv:pointer-events-none"
        />
      </Drawer.Popup>
    );
  },
);

export const BottomSheetContentDefault = React.forwardRef<HTMLDivElement, BottomSheetContentProps>(
  function BottomSheetContentDefault({ className, ...props }, ref) {
    const Comp = useStudioVaaiUiComponent("BottomSheetContent", BottomSheetContentImpl);
    return <Comp ref={ref} className={className} {...props} />;
  },
);
BottomSheetContentDefault.displayName = "BottomSheetContent";

export const BottomSheetContent = React.forwardRef<HTMLDivElement, BottomSheetContentProps>(
  function BottomSheetContent(props, ref) {
    return <BottomSheetContentDefault {...props} ref={ref} />;
  },
);
BottomSheetContent.displayName = "BottomSheetContent";

const bottomSheetShellRootClassName =
  "sv:flex sv:h-full sv:max-h-full sv:min-h-0 sv:flex-col sv:font-sans sv:text-[var(--sv-color-foreground)]";

const bottomSheetShellRootNoScrollClassName =
  "sv:flex sv:max-h-full sv:min-h-0 sv:flex-col sv:font-sans sv:text-[var(--sv-color-foreground)]";

const bottomSheetShellMainClassName =
  "sv-sheet-shell-scrollbar sv:@container sv:min-h-0 sv:flex-1 sv:px-6 sv:overflow-y-auto";

const bottomSheetShellMainNoScrollClassName =
  "sv:flex sv:flex-col sv:@container sv:min-h-0 sv:flex-1 sv:px-6 sv:overflow-hidden";

/** Inner layout for default-flow steps: grabber, header with back/close, scroll body, optional footer. Renders inside {@link BottomSheetContent}. */
export interface BottomSheetShellProps {
  /** Optional header label; rendered as `Drawer.Title` for the sheet dialog. */
  title?: React.ReactNode;
  /**
   * Optional second line under the title — the screen's one-sentence orientation
   * ("Upload a photo & try different sizes") or, on the try-on result, the variant
   * the shopper is looking at ("Waist 28 · Length 32 · Mid Blue"). Ignored when
   * `title` is absent, since it has nothing to sit under.
   */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  subfooter?: React.ReactNode;
  /** Header back control. When omitted, the back button is hidden. */
  onBack?: () => void;
  /** Header close control. */
  onClose: () => void;
  /** When true, header back/close controls are disabled (e.g. intro upload or try-on request in flight). */
  busy?: boolean;
  /** When false, the body region clips overflow instead of scrolling. Defaults to `true`. */
  scrollable?: boolean;
  /**
   * Stretch the sheet panel to the full viewport height instead of sizing it to its content.
   * For screens whose body is a full-bleed surface (the try-on photo), where a content-height
   * panel would leave a gap above the sheet. No-op in modal layout, which is already centered
   * at a fixed size.
   */
  fillHeight?: boolean;
  /**
   * Full-screen variant of {@link fillHeight} (implies it): the panel covers the entire
   * viewport — no backdrop sliver, no top radius — for the steps the reference draws
   * edge-to-edge (the try-on hero screens, whose header floats over the photo).
   */
  fillViewport?: boolean;
  /**
   * Paint the whole shell (header scrim included, via `--sv-shell-tint`) in this CSS color —
   * the try-on step passes the active render's sampled backdrop so the aspect-locked photo's
   * letterbox bands become invisible and the step reads as one seamless surface. Omit for the
   * default surface color.
   */
  surfaceTint?: string;
  /** Per-slot `className` overrides (see {@link SheetShellClassNames}). */
  classNames?: SheetShellClassNames;
}

export function BottomSheetShellDefault({
  title,
  subtitle,
  children,
  footer,
  subfooter,
  onBack,
  onClose,
  busy = false,
  scrollable = true,
  fillHeight = false,
  fillViewport = false,
  surfaceTint,
  classNames,
}: BottomSheetShellProps) {
  const { surface } = useStudioVaaiUiMessages();
  const fill = fillHeight || fillViewport;
  return (
    <div
      data-studio-vaai="surface-shell"
      // Read by the `.sv-sheet-content:has(…)` rules that stretch the panel — see the CSS.
      {...(fill ? { "data-sv-sheet-fill": "" } : {})}
      {...(fillViewport ? { "data-sv-sheet-viewport": "" } : {})}
      {...(surfaceTint === undefined
        ? {}
        : {
            style: {
              backgroundColor: surfaceTint,
              "--sv-shell-tint": surfaceTint,
            } as React.CSSProperties,
          })}
      className={cn(
        scrollable ? bottomSheetShellRootClassName : bottomSheetShellRootNoScrollClassName,
        fill && "sv:h-full",
        classNames?.root,
      )}
    >
      {/* No drag-handle grabber, on ANY step. The flow's sheets cover the viewport, so the pill
          only bought a strip of empty surface above each title; it was removed per-screen first
          (try-on, size step) and kept reappearing on the steps nobody had touched yet. The
          `classNames.grabber` slot stays for layout overrides but no longer renders a handle. */}
      <div
        // Queryable so a screen that floats content UNDER this header (the try-on sheet) can
        // measure its real height — the title wraps on long product names, so a constant would
        // be wrong exactly when it matters.
        data-studio-vaai="surface-shell-header"
        className={cn(
          // `pt-5`: the removed grabber row carried the sheet's top inset (`pt-4` + handle +
          // `pb-2`), so without a replacement the title sat flush against the panel's top edge.
          // Owned by the header now, roughly symmetric with the 24px side gutters.
          "sv:flex sv:min-h-[44px] sv:shrink-0 sv:items-center sv:justify-between sv:gap-2 sv:px-6 sv:pb-2 sv:pt-5",
          classNames?.header,
        )}
      >
        <div className="sv:flex sv:w-10 sv:shrink-0 sv:justify-start">
          {onBack !== undefined && (
            <Button
              type="button"
              variant="icon"
              disabled={busy}
              onClick={onBack}
              className={cn(classNames?.backButton)}
            >
              <span className="sv:sr-only">{surface.backSr}</span>
              <IconBack className="sv:size-4" />
            </Button>
          )}
        </div>
        <div className="sv:min-w-0 sv:flex-1">
          {title === undefined ? null : (
            <Drawer.Title
              className={cn(
                "sv:mx-0 sv:mt-0 sv:mb-0 sv:block sv:min-w-0 sv:w-full sv:shrink-0 sv:line-clamp-2 sv:text-center sv:text-base sv:font-semibold sv:leading-tight sv:text-[var(--sv-color-foreground)]",
                classNames?.title,
              )}
            >
              {title}
            </Drawer.Title>
          )}
          {title === undefined || subtitle === undefined ? null : (
            <span
              data-studio-vaai="surface-shell-subtitle"
              className={cn(
                "sv:mt-0.5 sv:block sv:min-w-0 sv:truncate sv:text-center sv:text-[14px] sv:font-light sv:leading-[140%] sv:text-[var(--sv-color-foreground-secondary)]",
                classNames?.subtitle,
              )}
            >
              {subtitle}
            </span>
          )}
        </div>
        <div className="sv:flex sv:w-10 sv:shrink-0 sv:justify-end sv:translate-x-3">
          <Button
            type="button"
            variant="icon"
            disabled={busy}
            onClick={onClose}
            className={cn(classNames?.closeButton)}
          >
            <span className="sv:sr-only">{surface.closeSr}</span>
            <IconClose className="sv:size-4" />
          </Button>
        </div>
      </div>
      <div
        className={cn(
          scrollable ? bottomSheetShellMainClassName : bottomSheetShellMainNoScrollClassName,
          classNames?.body,
        )}
        data-studio-vaai="surface-shell-main"
      >
        {children}
      </div>
      {footer === undefined ? null : (
        <div
          className={cn(
            "sv:shrink-0 sv:px-6 sv:pt-4 sv:pb-2",
            subfooter === undefined && "sv:pb-[max(1rem,env(safe-area-inset-bottom))]",
            classNames?.footer,
          )}
        >
          {footer}
        </div>
      )}
      {subfooter === undefined ? null : (
        <div
          className={cn(
            "sv:shrink-0 sv:pb-[calc(env(safe-area-inset-bottom)+0.25rem)] sv:pr-1",
            classNames?.subfooter,
          )}
        >
          {subfooter}
        </div>
      )}
    </div>
  );
}

export function BottomSheetShell(props: BottomSheetShellProps) {
  const Comp = useStudioVaaiUiComponent("BottomSheetShell", BottomSheetShellDefault);
  return <Comp {...props} />;
}

export type BottomSheetBleedSides = "both" | "left" | "right";

const BOTTOM_SHEET_BLEED_CLASS: Record<BottomSheetBleedSides, string> = {
  both: "sv:-mx-6",
  left: "sv:-ml-6",
  right: "sv:-mr-6",
};

const BOTTOM_SHEET_BLEED_INSET_CLASS: Record<BottomSheetBleedSides, string> = {
  both: "sv:px-6",
  left: "sv:pl-6",
  right: "sv:pr-6",
};

interface BottomSheetBleedState extends Record<string, unknown> {
  sides: BottomSheetBleedSides;
}

export interface BottomSheetBleedProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which sides to break out of the shell's horizontal padding. Defaults to `"both"`. */
  sides?: BottomSheetBleedSides;
  /** Allows replacing the rendered `<div>` with a different element or component. */
  render?: useRender.RenderProp<BottomSheetBleedState>;
}

/**
 * Cancels {@link BottomSheetShell}'s horizontal `px-6` so children render edge-to-edge.
 * Use for full-bleed media, carousels, or dividers inside the sheet body.
 */
export const BottomSheetBleedDefault = React.forwardRef<HTMLDivElement, BottomSheetBleedProps>(
  function BottomSheetBleedDefault({ className, sides = "both", render, ...props }, ref) {
    const state: BottomSheetBleedState = { sides };
    return useRender({
      render,
      ref,
      state,
      defaultTagName: "div",
      props: mergeProps<"div">(
        { className: cn(BOTTOM_SHEET_BLEED_CLASS[sides], className) },
        props,
      ),
    });
  },
);
BottomSheetBleedDefault.displayName = "BottomSheetBleed";

export const BottomSheetBleed = React.forwardRef<HTMLDivElement, BottomSheetBleedProps>(
  function BottomSheetBleed(props, ref) {
    const Comp = useStudioVaaiUiComponent("BottomSheetBleed", BottomSheetBleedDefault);
    return <Comp ref={ref} {...props} />;
  },
);
BottomSheetBleed.displayName = "BottomSheetBleed";

interface BottomSheetBleedInsetState extends Record<string, unknown> {
  sides: BottomSheetBleedSides;
}

export interface BottomSheetBleedInsetProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which sides to re-apply the shell's horizontal padding on. Mirror the matching {@link BottomSheetBleed}. Defaults to `"both"`. */
  sides?: BottomSheetBleedSides;
  /** Allows replacing the rendered `<div>` with a different element or component. */
  render?: useRender.RenderProp<BottomSheetBleedInsetState>;
}

/**
 * Re-applies {@link BottomSheetShell}'s horizontal `px-6` inside a {@link BottomSheetBleed}
 * scroll container, so content keeps the shell gutters even when the scroll area
 * extends edge-to-edge.
 */
export const BottomSheetBleedInsetDefault = React.forwardRef<
  HTMLDivElement,
  BottomSheetBleedInsetProps
>(function BottomSheetBleedInsetDefault({ className, sides = "both", render, ...props }, ref) {
  const state: BottomSheetBleedInsetState = { sides };
  return useRender({
    render,
    ref,
    state,
    defaultTagName: "div",
    props: mergeProps<"div">(
      { className: cn(BOTTOM_SHEET_BLEED_INSET_CLASS[sides], className) },
      props,
    ),
  });
});
BottomSheetBleedInsetDefault.displayName = "BottomSheetBleedInset";

export const BottomSheetBleedInset = React.forwardRef<HTMLDivElement, BottomSheetBleedInsetProps>(
  function BottomSheetBleedInset(props, ref) {
    const Comp = useStudioVaaiUiComponent("BottomSheetBleedInset", BottomSheetBleedInsetDefault);
    return <Comp ref={ref} {...props} />;
  },
);
BottomSheetBleedInset.displayName = "BottomSheetBleedInset";

export { bottomSheetBackdropVariants, bottomSheetContentVariants, bottomSheetViewportVariants };
