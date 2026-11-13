"use client";

import { Dialog } from "@base-ui/react/dialog";
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

/** Centered modal built on Base UI [Dialog](https://base-ui.com/react/components/dialog). */
export function ModalDefault(props: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root {...props} />;
}

export function Modal(props: React.ComponentProps<typeof Dialog.Root>) {
  const Comp = useStudioVaaiUiComponent("Modal", ModalDefault);
  return <Comp {...props} />;
}

function ModalPortalImpl({ children, ...props }: React.ComponentProps<typeof Dialog.Portal>) {
  // Portal children render into `document.body`, outside the provider's
  // `#studio-vaai-root` ancestor — re-establish it (and re-apply the `theme`
  // tokens, which don't cross the DOM portal boundary) so prefixed Tailwind matches.
  const theme = useStudioVaaiTheme();
  return (
    <Dialog.Portal {...props}>
      <StudioVaaiRoot tokens={theme}>{children}</StudioVaaiRoot>
    </Dialog.Portal>
  );
}

export function ModalPortalDefault(props: React.ComponentProps<typeof Dialog.Portal>) {
  const Comp = useStudioVaaiUiComponent("ModalPortal", ModalPortalImpl);
  return <Comp {...props} />;
}

export function ModalPortal(props: React.ComponentProps<typeof Dialog.Portal>) {
  return <ModalPortalDefault {...props} />;
}

function ModalDescriptionImpl(props: React.ComponentProps<typeof Dialog.Description>) {
  return <Dialog.Description {...props} />;
}

export function ModalDescriptionDefault(props: React.ComponentProps<typeof Dialog.Description>) {
  const Comp = useStudioVaaiUiComponent("ModalDescription", ModalDescriptionImpl);
  return <Comp {...props} />;
}

export function ModalDescription(props: React.ComponentProps<typeof Dialog.Description>) {
  return <ModalDescriptionDefault {...props} />;
}

function ModalTriggerImpl(props: React.ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger {...props} />;
}

export function ModalTriggerDefault(props: React.ComponentProps<typeof Dialog.Trigger>) {
  const Comp = useStudioVaaiUiComponent("ModalTrigger", ModalTriggerImpl);
  return <Comp {...props} />;
}

export function ModalTrigger(props: React.ComponentProps<typeof Dialog.Trigger>) {
  return <ModalTriggerDefault {...props} />;
}

function ModalCloseImpl(props: React.ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close {...props} />;
}

export function ModalCloseDefault(props: React.ComponentProps<typeof Dialog.Close>) {
  const Comp = useStudioVaaiUiComponent("ModalClose", ModalCloseImpl);
  return <Comp {...props} />;
}

export function ModalClose(props: React.ComponentProps<typeof Dialog.Close>) {
  return <ModalCloseDefault {...props} />;
}

const modalViewportVariants = cva(
  "sv:pointer-events-none sv:fixed sv:inset-0 sv:z-50 sv:flex sv:max-h-full sv:items-center sv:justify-center sv:p-4 sv:lg:p-6",
);

const modalBackdropVariants = cva(
  "sv-modal-backdrop sv:fixed sv:inset-0 sv:z-40 sv:bg-[var(--sv-color-overlay)]",
);

const modalContentVariants = cva(
  "sv-modal-content sv:pointer-events-auto sv:box-border sv:z-50 sv:flex sv:min-h-0 sv:flex-col sv:max-h-[min(96vh,100dvh)] sv:min-h-[min(800px,90vh)] sv:w-full sv:max-w-[1040px] sv:relative sv:rounded-[var(--sv-radius-modal)] sv:bg-[var(--sv-color-surface)] sv:shadow-[0_8px_32px_rgba(0,0,0,0.18)] sv:outline-none",
);

export type ModalBackdropProps = React.ComponentPropsWithoutRef<typeof Dialog.Backdrop>;

const ModalBackdropImpl = React.forwardRef<HTMLDivElement, ModalBackdropProps>(
  function ModalBackdropImpl({ className, ...props }, ref) {
    return (
      <Dialog.Backdrop ref={ref} className={cn(modalBackdropVariants(), className)} {...props} />
    );
  },
);

/** Stable no-op default for the {@link SheetDebugButton} override slot. */
function NullDebugButton(): null {
  return null;
}

export const ModalBackdropDefault = React.forwardRef<HTMLDivElement, ModalBackdropProps>(
  function ModalBackdropDefault({ className, ...props }, ref) {
    const Comp = useStudioVaaiUiComponent("ModalBackdrop", ModalBackdropImpl);
    const DebugButton = useStudioVaaiUiComponent("SheetDebugButton", NullDebugButton);
    return (
      <>
        <Comp ref={ref} className={className} {...props} />
        <div className="sv:fixed sv:top-4 sv:right-4 sv:z-50 sv:pointer-events-auto" aria-hidden>
          <DebugButton />
        </div>
      </>
    );
  },
);
ModalBackdropDefault.displayName = "ModalBackdrop";

export const ModalBackdrop = React.forwardRef<HTMLDivElement, ModalBackdropProps>(
  function ModalBackdrop(props, ref) {
    return <ModalBackdropDefault {...props} ref={ref} />;
  },
);
ModalBackdrop.displayName = "ModalBackdrop";

export type ModalViewportProps = React.ComponentPropsWithoutRef<typeof Dialog.Viewport>;

const ModalViewportImpl = React.forwardRef<HTMLDivElement, ModalViewportProps>(
  function ModalViewportImpl({ className, ...props }, ref) {
    return (
      <Dialog.Viewport ref={ref} className={cn(modalViewportVariants(), className)} {...props} />
    );
  },
);

export const ModalViewportDefault = React.forwardRef<HTMLDivElement, ModalViewportProps>(
  function ModalViewportDefault({ className, ...props }, ref) {
    const Comp = useStudioVaaiUiComponent("ModalViewport", ModalViewportImpl);
    return <Comp ref={ref} className={className} {...props} />;
  },
);
ModalViewportDefault.displayName = "ModalViewport";

export const ModalViewport = React.forwardRef<HTMLDivElement, ModalViewportProps>(
  function ModalViewport(props, ref) {
    return <ModalViewportDefault {...props} ref={ref} />;
  },
);
ModalViewport.displayName = "ModalViewport";

export type ModalContentProps = React.ComponentPropsWithoutRef<typeof Dialog.Popup>;

const ModalContentImpl = React.forwardRef<HTMLDivElement, ModalContentProps>(
  function ModalContentImpl({ className, children, ...props }, ref) {
    return (
      <Dialog.Popup ref={ref} className={cn(modalContentVariants(), className)} {...props}>
        {children}
      </Dialog.Popup>
    );
  },
);

export const ModalContentDefault = React.forwardRef<HTMLDivElement, ModalContentProps>(
  function ModalContentDefault({ className, ...props }, ref) {
    const Comp = useStudioVaaiUiComponent("ModalContent", ModalContentImpl);
    return <Comp ref={ref} className={className} {...props} />;
  },
);
ModalContentDefault.displayName = "ModalContent";

export const ModalContent = React.forwardRef<HTMLDivElement, ModalContentProps>(
  function ModalContent(props, ref) {
    return <ModalContentDefault {...props} ref={ref} />;
  },
);
ModalContent.displayName = "ModalContent";

const modalShellRootClassName =
  "sv:flex sv:max-h-full sv:min-h-0 sv:flex-col sv:font-sans sv:text-[var(--sv-color-foreground)]";

const modalShellMainClassName =
  "sv:@container sv:flex sv:flex-col sv:min-h-0 sv:flex-1 sv:px-6 sv:py-6 sv:overflow-hidden";

/** Inner layout for default-flow steps in modal mode: header with back/close, clipped body, optional footer. Renders inside {@link ModalContent}. */
export interface ModalShellProps {
  /** Optional header label; rendered as `Dialog.Title` for the modal dialog. */
  title?: React.ReactNode;
  /**
   * Optional second line under the title. Mirrors {@link BottomSheetShellProps.subtitle};
   * ignored when `title` is absent.
   */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Header back control. When omitted, the back button is hidden. */
  onBack?: () => void;
  /** Header close control. */
  onClose: () => void;
  /** When true, header back/close controls are disabled (e.g. intro upload or try-on request in flight). */
  busy?: boolean;
  /**
   * Accepted for parity with {@link BottomSheetShell} but ignored — the modal body
   * never scrolls; tall content is expected to be capped per-screen.
   */
  scrollable?: boolean;
  /**
   * Stretch the shell to the dialog's full height. The dialog holds one height across the whole
   * flow (see `--sv-modal-height`), so without this the shell sizes to its content and leaves
   * dead space below the footer on the shorter steps.
   */
  fillHeight?: boolean;
  /**
   * Accepted for parity with {@link BottomSheetShell} but ignored — the modal is a centered
   * dialog and never goes full-viewport.
   */
  fillViewport?: boolean;
  /**
   * Accepted for parity with {@link BottomSheetShell} but ignored — the modal keeps its own
   * surface; the seamless-backdrop treatment is a sheet-only, full-screen affair.
   */
  surfaceTint?: string;
  /**
   * Trailing strip under the footer — the "powered by" attribution. Rendered here as well as on
   * the sheet: the attribution has to survive on every surface, and a desktop-only omission is
   * how it silently disappeared once already.
   */
  subfooter?: React.ReactNode;
  /**
   * Per-slot `className` overrides (see {@link SheetShellClassNames}). The modal
   * has no grabber, so that key is a no-op here.
   */
  classNames?: SheetShellClassNames;
}

export function ModalShellDefault({
  title,
  subtitle,
  children,
  footer,
  subfooter,
  onBack,
  onClose,
  busy = false,
  fillHeight = false,
  classNames,
}: ModalShellProps) {
  const { surface } = useStudioVaaiUiMessages();
  return (
    <div
      data-studio-vaai="surface-shell"
      className={cn(modalShellRootClassName, fillHeight && "sv:h-full", classNames?.root)}
    >
      <div
        className={cn(
          "sv:flex sv:shrink-0 sv:items-center sv:justify-between sv:gap-2 sv:px-6 sv:pb-2 sv:pt-2",
          classNames?.header,
        )}
      >
        <div className="sv:flex sv:w-10 sv:shrink-0 sv:justify-start sv:-translate-x-3">
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
            <Dialog.Title
              className={cn(
                "sv:mx-0 sv:mt-0 sv:mb-0 sv:flex sv:min-w-0 sv:w-full sv:shrink-0 sv:flex-row sv:items-center sv:justify-center sv:gap-2 sv:truncate sv:text-center sv:text-[24px] sv:font-medium sv:leading-[140%] sv:text-[var(--sv-color-foreground)]",
                classNames?.title,
              )}
            >
              {title}
            </Dialog.Title>
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
        className={cn(modalShellMainClassName, classNames?.body)}
        data-studio-vaai="surface-shell-main"
      >
        {children}
      </div>
      {footer === undefined ? null : (
        <div className={cn("sv:shrink-0 sv:px-6 sv:py-4", classNames?.footer)}>{footer}</div>
      )}
      {subfooter === undefined ? null : (
        <div className={cn("sv:shrink-0 sv:px-6 sv:pb-3", classNames?.subfooter)}>{subfooter}</div>
      )}
    </div>
  );
}

export function ModalShell(props: ModalShellProps) {
  const Comp = useStudioVaaiUiComponent("ModalShell", ModalShellDefault);
  return <Comp {...props} />;
}

export type ModalBleedSides = "both" | "left" | "right";

const MODAL_BLEED_CLASS: Record<ModalBleedSides, string> = {
  both: "sv:-mx-6",
  left: "sv:-ml-6",
  right: "sv:-mr-6",
};

const MODAL_BLEED_INSET_CLASS: Record<ModalBleedSides, string> = {
  both: "sv:px-6",
  left: "sv:pl-6",
  right: "sv:pr-6",
};

interface ModalBleedState extends Record<string, unknown> {
  sides: ModalBleedSides;
}

export interface ModalBleedProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which sides to break out of the shell's horizontal padding. Defaults to `"both"`. */
  sides?: ModalBleedSides;
  /** Allows replacing the rendered `<div>` with a different element or component. */
  render?: useRender.RenderProp<ModalBleedState>;
}

/**
 * Cancels {@link ModalShell}'s horizontal `px-6` so children render edge-to-edge.
 * Use for full-bleed media, carousels, or dividers inside the modal body.
 */
export const ModalBleedDefault = React.forwardRef<HTMLDivElement, ModalBleedProps>(
  function ModalBleedDefault({ className, sides = "both", render, ...props }, ref) {
    const state: ModalBleedState = { sides };
    return useRender({
      render,
      ref,
      state,
      defaultTagName: "div",
      props: mergeProps<"div">({ className: cn(MODAL_BLEED_CLASS[sides], className) }, props),
    });
  },
);
ModalBleedDefault.displayName = "ModalBleed";

export const ModalBleed = React.forwardRef<HTMLDivElement, ModalBleedProps>(
  function ModalBleed(props, ref) {
    const Comp = useStudioVaaiUiComponent("ModalBleed", ModalBleedDefault);
    return <Comp ref={ref} {...props} />;
  },
);
ModalBleed.displayName = "ModalBleed";

interface ModalBleedInsetState extends Record<string, unknown> {
  sides: ModalBleedSides;
}

export interface ModalBleedInsetProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which sides to re-apply the shell's horizontal padding on. Mirror the matching {@link ModalBleed}. Defaults to `"both"`. */
  sides?: ModalBleedSides;
  /** Allows replacing the rendered `<div>` with a different element or component. */
  render?: useRender.RenderProp<ModalBleedInsetState>;
}

/**
 * Re-applies {@link ModalShell}'s horizontal `px-6` inside a {@link ModalBleed} scroll
 * container, so content keeps the shell gutters even when the scroll area extends
 * edge-to-edge.
 */
export const ModalBleedInsetDefault = React.forwardRef<HTMLDivElement, ModalBleedInsetProps>(
  function ModalBleedInsetDefault({ className, sides = "both", render, ...props }, ref) {
    const state: ModalBleedInsetState = { sides };
    return useRender({
      render,
      ref,
      state,
      defaultTagName: "div",
      props: mergeProps<"div">({ className: cn(MODAL_BLEED_INSET_CLASS[sides], className) }, props),
    });
  },
);
ModalBleedInsetDefault.displayName = "ModalBleedInset";

export const ModalBleedInset = React.forwardRef<HTMLDivElement, ModalBleedInsetProps>(
  function ModalBleedInset(props, ref) {
    const Comp = useStudioVaaiUiComponent("ModalBleedInset", ModalBleedInsetDefault);
    return <Comp ref={ref} {...props} />;
  },
);
ModalBleedInset.displayName = "ModalBleedInset";
