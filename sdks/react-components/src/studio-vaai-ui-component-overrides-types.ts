import type { TryOnProvenance } from "@studio-vaai/js-client";
import type { ReactElement } from "react";

import type { ActionsSectionDefault } from "./ui/actions-section.js";
import type {
  BottomSheetBackdropDefault,
  BottomSheetBleedDefault,
  BottomSheetBleedInsetDefault,
  BottomSheetCloseDefault,
  BottomSheetContentDefault,
  BottomSheetDefault,
  BottomSheetDescriptionDefault,
  BottomSheetPortalDefault,
  BottomSheetShellDefault,
  BottomSheetTriggerDefault,
  BottomSheetViewportDefault,
} from "./ui/bottom-sheet.js";
import type { ButtonDefault } from "./ui/button.js";
import type { CheckboxIndicatorDefault, CheckboxRootDefault } from "./ui/checkbox.js";
import type { ChipDefault } from "./ui/chip.js";
import type { DefaultFlowSheetMountDefault } from "./ui/default-flow-sheet-mount.js";
import type { DisclosureDefault } from "./ui/disclosure.js";
import type { FactListDefault } from "./ui/fact-list.js";
import type { FitScorePanelDefault, FitScoreUnavailableDefault } from "./ui/fit-score-panel.js";
import type { GuideGraphicDefault } from "./ui/guide-graphic.js";
import type { HeightCmPickerStepperDefault } from "./ui/height-cm-picker-stepper.js";
import type { HeightCmPickerWheelDefault } from "./ui/height-cm-picker-wheel.js";
import type { HeightCmPickerDefault } from "./ui/height-cm-picker.js";
import type {
  IconAlertCircleDefault,
  IconBackDefault,
  IconCameraDefault,
  IconCarouselArrowLeftDefault,
  IconCarouselArrowRightDefault,
  IconCheckDefault,
  IconChevronDownDefault,
  IconChevronRightDefault,
  IconCloseDefault,
  IconEyeDefault,
  IconImageDefault,
  IconInfoDefault,
  IconDownloadDefault,
  IconRetryDefault,
  IconStyleButtonedDownDefault,
  IconStyleButtonedUpDefault,
  IconSwitchCameraDefault,
  IconTrashDefault,
} from "./ui/icons.js";
import type { ImageViewDefault } from "./ui/image-view.js";
import type {
  ModalBackdropDefault,
  ModalBleedDefault,
  ModalBleedInsetDefault,
  ModalCloseDefault,
  ModalContentDefault,
  ModalDefault,
  ModalDescriptionDefault,
  ModalPortalDefault,
  ModalShellDefault,
  ModalTriggerDefault,
  ModalViewportDefault,
} from "./ui/modal.js";
import type { NumberedStepsDefault } from "./ui/numbered-steps.js";
import type { PoweredByDefault } from "./ui/powered-by.js";
import type {
  SheetBackdropDefault,
  SheetBleedDefault,
  SheetBleedInsetDefault,
  SheetCloseDefault,
  SheetContentDefault,
  SheetDefault,
  SheetDescriptionDefault,
  SheetPortalDefault,
  SheetShellDefault,
  SheetTriggerDefault,
  SheetViewportDefault,
} from "./ui/sheet.js";
import type { SpinnerDefault } from "./ui/spinner.js";
import type { StyleToggleDefault } from "./ui/style-toggle.js";
import type { SwatchDefault } from "./ui/swatch.js";
import type { VStackDefault } from "./ui/v-stack.js";
import type { VariantPickerDefault } from "./ui/variant-picker.js";

/** What a {@link StudioVaaiUiComponentOverrides.TryOnImageOverlay} labels: the render on show. */
export interface TryOnImageOverlayProps {
  /** The server's id for the render; absent on slides that do not carry it. */
  tryOnId?: string;
  /** The variant attributes that produced the render. */
  attributes: Readonly<Record<string, string>>;
  /** Where the render came from, when the server reported it. */
  provenance?: TryOnProvenance;
}

/**
 * Optional replacements for studio vaai UI primitives. Keys omitted use the built-in implementation.
 */
export interface StudioVaaiUiComponentOverrides {
  Button?: typeof ButtonDefault;
  Chip?: typeof ChipDefault;
  Swatch?: typeof SwatchDefault;
  ActionsSection?: typeof ActionsSectionDefault;
  VStack?: typeof VStackDefault;
  ImageView?: typeof ImageViewDefault;
  Spinner?: typeof SpinnerDefault;
  HeightCmPicker?: typeof HeightCmPickerDefault;
  HeightCmPickerWheel?: typeof HeightCmPickerWheelDefault;
  HeightCmPickerStepper?: typeof HeightCmPickerStepperDefault;
  GuideGraphic?: typeof GuideGraphicDefault;
  CheckboxRoot?: typeof CheckboxRootDefault;
  CheckboxIndicator?: typeof CheckboxIndicatorDefault;
  Sheet?: typeof SheetDefault;
  SheetBackdrop?: typeof SheetBackdropDefault;
  SheetViewport?: typeof SheetViewportDefault;
  SheetContent?: typeof SheetContentDefault;
  SheetShell?: typeof SheetShellDefault;
  SheetBleed?: typeof SheetBleedDefault;
  SheetBleedInset?: typeof SheetBleedInsetDefault;
  SheetPortal?: typeof SheetPortalDefault;
  SheetDescription?: typeof SheetDescriptionDefault;
  SheetTrigger?: typeof SheetTriggerDefault;
  SheetClose?: typeof SheetCloseDefault;
  BottomSheet?: typeof BottomSheetDefault;
  BottomSheetBackdrop?: typeof BottomSheetBackdropDefault;
  BottomSheetViewport?: typeof BottomSheetViewportDefault;
  BottomSheetContent?: typeof BottomSheetContentDefault;
  BottomSheetShell?: typeof BottomSheetShellDefault;
  BottomSheetBleed?: typeof BottomSheetBleedDefault;
  BottomSheetBleedInset?: typeof BottomSheetBleedInsetDefault;
  BottomSheetPortal?: typeof BottomSheetPortalDefault;
  BottomSheetDescription?: typeof BottomSheetDescriptionDefault;
  BottomSheetTrigger?: typeof BottomSheetTriggerDefault;
  BottomSheetClose?: typeof BottomSheetCloseDefault;
  Modal?: typeof ModalDefault;
  ModalBackdrop?: typeof ModalBackdropDefault;
  ModalViewport?: typeof ModalViewportDefault;
  ModalContent?: typeof ModalContentDefault;
  ModalShell?: typeof ModalShellDefault;
  ModalBleed?: typeof ModalBleedDefault;
  ModalBleedInset?: typeof ModalBleedInsetDefault;
  ModalPortal?: typeof ModalPortalDefault;
  ModalDescription?: typeof ModalDescriptionDefault;
  ModalTrigger?: typeof ModalTriggerDefault;
  ModalClose?: typeof ModalCloseDefault;
  DefaultFlowSheetMount?: typeof DefaultFlowSheetMountDefault;
  PoweredBy?: typeof PoweredByDefault;
  Disclosure?: typeof DisclosureDefault;
  FitScorePanel?: typeof FitScorePanelDefault;
  FitScoreUnavailable?: typeof FitScoreUnavailableDefault;
  VariantPicker?: typeof VariantPickerDefault;
  StyleToggle?: typeof StyleToggleDefault;
  NumberedSteps?: typeof NumberedStepsDefault;
  FactList?: typeof FactListDefault;
  /** Optional debug entry button rendered inside {@link SheetShell}. Renders nothing by default; provide via `@studio-vaai/react-components/debug` when `@studio-vaai/js-debugger` is active. */
  SheetDebugButton?: () => ReactElement | null;
  /**
   * Optional chrome over the finished try-on image, pinned to its top-left corner (e.g. a host's
   * provenance label). Renders nothing by default, and the screen adds nothing to the layout
   * unless this is provided: whatever it draws floats over the image.
   */
  TryOnImageOverlay?: (props: TryOnImageOverlayProps) => ReactElement | null;
  IconBack?: typeof IconBackDefault;
  IconChevronRight?: typeof IconChevronRightDefault;
  IconChevronDown?: typeof IconChevronDownDefault;
  IconCheck?: typeof IconCheckDefault;
  IconEye?: typeof IconEyeDefault;
  IconTrash?: typeof IconTrashDefault;
  IconCarouselArrowLeft?: typeof IconCarouselArrowLeftDefault;
  IconCarouselArrowRight?: typeof IconCarouselArrowRightDefault;
  IconClose?: typeof IconCloseDefault;
  IconCamera?: typeof IconCameraDefault;
  IconAlertCircle?: typeof IconAlertCircleDefault;
  IconImage?: typeof IconImageDefault;
  IconInfo?: typeof IconInfoDefault;
  IconSwitchCamera?: typeof IconSwitchCameraDefault;
  IconDownload?: typeof IconDownloadDefault;
  IconRetry?: typeof IconRetryDefault;
  IconStyleButtonedUp?: typeof IconStyleButtonedUpDefault;
  IconStyleButtonedDown?: typeof IconStyleButtonedDownDefault;
}
