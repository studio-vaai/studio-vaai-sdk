"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react";
import * as React from "react";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";

const checkboxRootClassName = cn(
  "sv:box-border sv:mt-0.5 sv:inline-flex sv:h-[16px] sv:w-[16px] sv:min-h-[16px] sv:min-w-[16px] sv:shrink-0 sv:items-center sv:justify-center sv:rounded-[2px] sv:border-2 sv:border-solid sv:border-[var(--sv-color-primary)] sv:bg-white sv:data-[checked]:bg-[var(--sv-color-primary)]",
);

function CheckboxRootImpl({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root className={cn(checkboxRootClassName, className)} {...props} />;
}

export const CheckboxRootDefault = function CheckboxRoot({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  const Comp = useStudioVaaiUiComponent("CheckboxRoot", CheckboxRootImpl);
  return <Comp className={className} {...props} />;
};

const CheckboxIndicatorImpl = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Indicator>
>(function CheckboxIndicatorImpl({ className, children, ...props }, ref) {
  return (
    <CheckboxPrimitive.Indicator ref={ref} className={cn("sv:text-white", className)} {...props}>
      {children ?? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2 6l3 3 5-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </CheckboxPrimitive.Indicator>
  );
});
CheckboxIndicatorImpl.displayName = "CheckboxIndicator";

export const CheckboxIndicatorDefault = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Indicator>
>(function CheckboxIndicator({ className, children, ...props }, ref) {
  const Comp = useStudioVaaiUiComponent("CheckboxIndicator", CheckboxIndicatorImpl);
  return (
    <Comp ref={ref} className={className} {...props}>
      {children}
    </Comp>
  );
});
CheckboxIndicatorDefault.displayName = "CheckboxIndicator";

/** Base UI checkbox with studio vaai styling (shadcn-style compound API). */
export const Checkbox = {
  Root: CheckboxRootDefault,
  Indicator: CheckboxIndicatorDefault,
};
