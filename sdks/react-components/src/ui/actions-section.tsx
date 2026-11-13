"use client";

import type { ReactNode } from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { cn } from "./cn.js";
import { VStack } from "./v-stack.js";

export interface ActionsSectionProps {
  className?: string;
  /** Primary action (typically `Button` with default variant). */
  primary: ReactNode;
  /** Secondary / alternate action (typically `Button` with `variant="ghost"`). */
  secondary?: ReactNode;
}

/** Stacked primary + optional secondary actions with consistent spacing (sheet footers, error flows, etc.). Switches to a horizontal pair in modal layout. */
export function ActionsSectionDefault({ className, primary, secondary }: ActionsSectionProps) {
  const { responsive } = useStudioVaaiUi();
  if (responsive.layout === "modal") {
    return (
      <div
        data-studio-vaai="actions-section"
        className={cn(
          "sv:flex sv:flex-row sv:items-center sv:justify-end sv:gap-4 sv:w-full",
          className,
        )}
      >
        {secondary === undefined ? null : secondary}
        {primary}
      </div>
    );
  }
  return (
    <VStack data-studio-vaai="actions-section" gap="md" className={className}>
      {primary}
      {secondary === undefined ? null : secondary}
    </VStack>
  );
}

export function ActionsSection(props: ActionsSectionProps) {
  const Comp = useStudioVaaiUiComponent("ActionsSection", ActionsSectionDefault);
  return <Comp {...props} />;
}
