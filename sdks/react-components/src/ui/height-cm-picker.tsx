"use client";

import type { HeightCmPickerProps } from "./height-cm-picker-shared.js";

import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { HeightCmPickerStepper } from "./height-cm-picker-stepper.js";
import { HeightCmPickerWheel } from "./height-cm-picker-wheel.js";

export type { HeightCmPickerProps };

/** Routes to the touch wheel ({@link HeightCmPickerWheel}) on coarse pointers and the stepper ({@link HeightCmPickerStepper}) on fine pointers. */
export function HeightCmPickerDefault(props: HeightCmPickerProps) {
  const { responsive } = useStudioVaaiUi();
  return responsive.pointer === "coarse" ? (
    <HeightCmPickerWheel {...props} />
  ) : (
    <HeightCmPickerStepper {...props} />
  );
}

export function HeightCmPicker(props: HeightCmPickerProps) {
  const Comp = useStudioVaaiUiComponent("HeightCmPicker", HeightCmPickerDefault);
  return <Comp {...props} />;
}
