"use client";

import type { Drawer } from "@base-ui/react/drawer";

import { createContext, useContext, type ReactNode } from "react";
import * as React from "react";

import type { SheetShellClassNames } from "./sheet-shell-class-names.js";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { useShellClassNames } from "../theme-context.js";
import {
  BottomSheet,
  BottomSheetBackdrop,
  BottomSheetBleed,
  BottomSheetBleedInset,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetPortal,
  BottomSheetShell,
  BottomSheetTrigger,
  BottomSheetViewport,
  bottomSheetBackdropVariants,
  bottomSheetContentVariants,
  bottomSheetViewportVariants,
  type BottomSheetBackdropProps,
  type BottomSheetBleedInsetProps,
  type BottomSheetBleedProps,
  type BottomSheetContentProps,
  type BottomSheetShellProps,
  type BottomSheetViewportProps,
} from "./bottom-sheet.js";
import { cn } from "./cn.js";
import {
  Modal,
  ModalBackdrop,
  ModalBleed,
  ModalBleedInset,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalPortal,
  ModalShell,
  ModalTrigger,
  ModalViewport,
} from "./modal.js";

type SheetKind = "bottomSheet" | "modal";

const SheetKindContext = createContext<SheetKind>("bottomSheet");

function useSheetKind(): SheetKind {
  return useContext(SheetKindContext);
}

function SheetKindProvider({
  kind,
  children,
}: {
  kind: SheetKind;
  children: ReactNode;
}): React.ReactElement {
  return <SheetKindContext.Provider value={kind}>{children}</SheetKindContext.Provider>;
}

/** Routes to {@link BottomSheet} on small viewports and {@link Modal} on larger ones. */
export function SheetDefault(props: React.ComponentProps<typeof Drawer.Root>) {
  const { responsive } = useStudioVaaiUi();
  const kind: SheetKind = responsive.layout === "bottomSheet" ? "bottomSheet" : "modal";
  return (
    <SheetKindProvider kind={kind}>
      {kind === "bottomSheet" ? <BottomSheet {...props} /> : <Modal {...props} />}
    </SheetKindProvider>
  );
}

export function Sheet(props: React.ComponentProps<typeof Drawer.Root>) {
  const Comp = useStudioVaaiUiComponent("Sheet", SheetDefault);
  return <Comp {...props} />;
}

export function SheetPortalDefault(props: React.ComponentProps<typeof Drawer.Portal>) {
  const kind = useSheetKind();
  return kind === "bottomSheet" ? <BottomSheetPortal {...props} /> : <ModalPortal {...props} />;
}

export function SheetPortal(props: React.ComponentProps<typeof Drawer.Portal>) {
  const Comp = useStudioVaaiUiComponent("SheetPortal", SheetPortalDefault);
  return <Comp {...props} />;
}

export function SheetDescriptionDefault(props: React.ComponentProps<typeof Drawer.Description>) {
  const kind = useSheetKind();
  return kind === "bottomSheet" ? (
    <BottomSheetDescription {...props} />
  ) : (
    <ModalDescription {...props} />
  );
}

export function SheetDescription(props: React.ComponentProps<typeof Drawer.Description>) {
  const Comp = useStudioVaaiUiComponent("SheetDescription", SheetDescriptionDefault);
  return <Comp {...props} />;
}

export function SheetTriggerDefault(props: React.ComponentProps<typeof Drawer.Trigger>) {
  const kind = useSheetKind();
  return kind === "bottomSheet" ? <BottomSheetTrigger {...props} /> : <ModalTrigger {...props} />;
}

export function SheetTrigger(props: React.ComponentProps<typeof Drawer.Trigger>) {
  const Comp = useStudioVaaiUiComponent("SheetTrigger", SheetTriggerDefault);
  return <Comp {...props} />;
}

export function SheetCloseDefault(props: React.ComponentProps<typeof Drawer.Close>) {
  const kind = useSheetKind();
  return kind === "bottomSheet" ? <BottomSheetClose {...props} /> : <ModalClose {...props} />;
}

export function SheetClose(props: React.ComponentProps<typeof Drawer.Close>) {
  const Comp = useStudioVaaiUiComponent("SheetClose", SheetCloseDefault);
  return <Comp {...props} />;
}

export type SheetBackdropProps = BottomSheetBackdropProps;

export const SheetBackdropDefault = React.forwardRef<HTMLDivElement, SheetBackdropProps>(
  function SheetBackdropDefault(props, ref) {
    const kind = useSheetKind();
    return kind === "bottomSheet" ? (
      <BottomSheetBackdrop ref={ref} {...props} />
    ) : (
      <ModalBackdrop ref={ref} {...props} />
    );
  },
);
SheetBackdropDefault.displayName = "SheetBackdrop";

export const SheetBackdrop = React.forwardRef<HTMLDivElement, SheetBackdropProps>(
  function SheetBackdrop(props, ref) {
    const Comp = useStudioVaaiUiComponent("SheetBackdrop", SheetBackdropDefault);
    return <Comp ref={ref} {...props} />;
  },
);
SheetBackdrop.displayName = "SheetBackdrop";

export type SheetViewportProps = BottomSheetViewportProps;

export const SheetViewportDefault = React.forwardRef<HTMLDivElement, SheetViewportProps>(
  function SheetViewportDefault(props, ref) {
    const kind = useSheetKind();
    return kind === "bottomSheet" ? (
      <BottomSheetViewport ref={ref} {...props} />
    ) : (
      <ModalViewport ref={ref} {...props} />
    );
  },
);
SheetViewportDefault.displayName = "SheetViewport";

export const SheetViewport = React.forwardRef<HTMLDivElement, SheetViewportProps>(
  function SheetViewport(props, ref) {
    const Comp = useStudioVaaiUiComponent("SheetViewport", SheetViewportDefault);
    return <Comp ref={ref} {...props} />;
  },
);
SheetViewport.displayName = "SheetViewport";

export type SheetContentProps = BottomSheetContentProps;

export const SheetContentDefault = React.forwardRef<HTMLDivElement, SheetContentProps>(
  function SheetContentDefault(props, ref) {
    const kind = useSheetKind();
    return kind === "bottomSheet" ? (
      <BottomSheetContent ref={ref} {...props} />
    ) : (
      <ModalContent ref={ref} {...(props as React.ComponentPropsWithoutRef<typeof ModalContent>)} />
    );
  },
);
SheetContentDefault.displayName = "SheetContent";

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  function SheetContent(props, ref) {
    const Comp = useStudioVaaiUiComponent("SheetContent", SheetContentDefault);
    return <Comp ref={ref} {...props} />;
  },
);
SheetContent.displayName = "SheetContent";

export type SheetShellProps = BottomSheetShellProps;

/**
 * Per-slot merge of a screen's own shell classes with the tree-wide ones.
 *
 * These used to be either/or — a screen supplying `classNames` replaced the host's entirely.
 * That was survivable while only hosts used the prop, but the redesigned screens set their own
 * layout classes (making the body a flex column, trimming footer padding), which would have
 * silently disabled every host customization on those steps. Host classes are concatenated
 * LAST so `tailwind-merge` still lets a host win a conflict.
 */
function mergeShellClassNames(
  screen: SheetShellClassNames | undefined,
  host: SheetShellClassNames | undefined,
): SheetShellClassNames | undefined {
  if (screen === undefined) {
    return host;
  }
  if (host === undefined) {
    return screen;
  }
  const keys = new Set([...Object.keys(screen), ...Object.keys(host)]) as Set<
    keyof SheetShellClassNames
  >;
  const out: SheetShellClassNames = {};
  for (const key of keys) {
    const merged = cn(screen[key], host[key]);
    if (merged.length > 0) {
      out[key] = merged;
    }
  }
  return out;
}

export function SheetShellDefault(props: SheetShellProps) {
  const kind = useSheetKind();
  // Tree-wide shell `classNames` (e.g. from `StudioVaaiDefaultFlow`) merged with whatever the
  // screen sets for its own layout — see `mergeShellClassNames`.
  const contextClassNames = useShellClassNames();
  const classNames = mergeShellClassNames(props.classNames, contextClassNames);
  const merged = classNames === undefined ? props : { ...props, classNames };
  return kind === "bottomSheet" ? <BottomSheetShell {...merged} /> : <ModalShell {...merged} />;
}

export function SheetShell(props: SheetShellProps) {
  const Comp = useStudioVaaiUiComponent("SheetShell", SheetShellDefault);
  return <Comp {...props} />;
}

export { bottomSheetBackdropVariants as sheetBackdropVariants };
export { bottomSheetContentVariants as sheetContentVariants };
export { bottomSheetViewportVariants as sheetViewportVariants };
export {
  defaultIsPopupEnterAnimating,
  defaultResolveSurfacePopup,
  defaultResolveSurfaceShell,
  defaultResolveSurfaceShellMain,
  defaultSurfaceLandmarks,
  mergeSurfaceLandmarks,
  SURFACE_SHELL_MAIN_SELECTOR,
  SURFACE_SHELL_SELECTOR,
  type PartialSurfaceLandmarks,
  type SurfaceLandmarkResolver,
  type SurfaceLandmarks,
} from "./surface-landmarks.js";

export type SheetBleedProps = BottomSheetBleedProps;

/**
 * Cancels the horizontal padding applied by {@link SheetShell} so children render
 * edge-to-edge. Routes to {@link BottomSheetBleed} or {@link ModalBleed} depending
 * on the active sheet kind.
 */
export const SheetBleedDefault = React.forwardRef<HTMLDivElement, SheetBleedProps>(
  function SheetBleedDefault(props, ref) {
    const kind = useSheetKind();
    return kind === "bottomSheet" ? (
      <BottomSheetBleed ref={ref} {...props} />
    ) : (
      <ModalBleed ref={ref} {...props} />
    );
  },
);
SheetBleedDefault.displayName = "SheetBleed";

export const SheetBleed = React.forwardRef<HTMLDivElement, SheetBleedProps>(
  function SheetBleed(props, ref) {
    const Comp = useStudioVaaiUiComponent("SheetBleed", SheetBleedDefault);
    return <Comp ref={ref} {...props} />;
  },
);
SheetBleed.displayName = "SheetBleed";

export type SheetBleedInsetProps = BottomSheetBleedInsetProps;

/**
 * Re-applies the shell's horizontal padding inside a {@link SheetBleed} so children
 * keep the shell gutters even when the bleed extends them edge-to-edge. Routes to
 * {@link BottomSheetBleedInset} or {@link ModalBleedInset}.
 */
export const SheetBleedInsetDefault = React.forwardRef<HTMLDivElement, SheetBleedInsetProps>(
  function SheetBleedInsetDefault(props, ref) {
    const kind = useSheetKind();
    return kind === "bottomSheet" ? (
      <BottomSheetBleedInset ref={ref} {...props} />
    ) : (
      <ModalBleedInset ref={ref} {...props} />
    );
  },
);
SheetBleedInsetDefault.displayName = "SheetBleedInset";

export const SheetBleedInset = React.forwardRef<HTMLDivElement, SheetBleedInsetProps>(
  function SheetBleedInset(props, ref) {
    const Comp = useStudioVaaiUiComponent("SheetBleedInset", SheetBleedInsetDefault);
    return <Comp ref={ref} {...props} />;
  },
);
SheetBleedInset.displayName = "SheetBleedInset";
