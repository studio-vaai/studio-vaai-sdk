"use client";

import type { ReactNode } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiTheme } from "../theme-context.js";
import { Sheet, SheetBackdrop, SheetContent, SheetPortal, SheetViewport } from "./sheet.js";
import { StudioVaaiRoot } from "./studio-vaai-root.js";

export interface DefaultFlowSheetMountProps {
  /** Applied to {@link SheetBackdrop} (same role as legacy backdrop `className`). */
  backdropClassName?: string | undefined;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Portal, backdrop, viewport, and sheet surface for default-flow steps; batteries render `SheetShell` inside. */
export function DefaultFlowSheetMountDefault({
  backdropClassName,
  children,
  open,
  onOpenChange,
}: DefaultFlowSheetMountProps) {
  const theme = useStudioVaaiTheme();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <StudioVaaiRoot tokens={theme}>
          <SheetBackdrop className={backdropClassName} />
          <SheetViewport>
            <SheetContent>{children}</SheetContent>
          </SheetViewport>
        </StudioVaaiRoot>
      </SheetPortal>
    </Sheet>
  );
}

export function DefaultFlowSheetMount(props: DefaultFlowSheetMountProps) {
  const Comp = useStudioVaaiUiComponent("DefaultFlowSheetMount", DefaultFlowSheetMountDefault);
  return <Comp {...props} />;
}
