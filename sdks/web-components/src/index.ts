/**
 * `@studio-vaai/web-components` — the try-on UI as framework-free custom elements.
 *
 * This entry has no side effects: it exports the element classes and their typed props. Theming
 * is public only as CSS custom properties (`--sv-*`); the token data and color math in
 * `src/internal/` are not part of the package API. Register the elements with `defineSvElements()` or `import
 * "@studio-vaai/web-components/define"`.
 */
export {
  SvAlertDialog,
  type SvAlertDialogProps,
  type SvCancelDetail,
} from "./components/alert-dialog/sv-alert-dialog.js";
export {
  SV_BADGE_VARIANTS,
  SvBadge,
  type SvBadgeProps,
  type SvBadgeVariant,
} from "./components/badge/sv-badge.js";
export {
  SV_BUTTON_VARIANTS,
  SvButton,
  type SvButtonProps,
  type SvButtonVariant,
} from "./components/button/sv-button.js";
export { SvCheckbox, type SvCheckboxProps } from "./components/checkbox/sv-checkbox.js";
export {
  SV_CHIP_STATUSES,
  SvChip,
  type SvChipProps,
  type SvChipStatus,
} from "./components/chip/sv-chip.js";
export {
  SV_DISMISS_REASONS,
  SvDialog,
  type SvDialogProps,
  type SvDialogShape,
  type SvDismissDetail,
  type SvDismissReason,
} from "./components/dialog/sv-dialog.js";
export {
  SvDisclosure,
  type SvDisclosureProps,
  type SvToggleDetail,
} from "./components/disclosure/sv-disclosure.js";
export {
  SV_FIT_CALLOUT_VARIANTS,
  SvFitCallout,
  type SvFitCalloutProps,
  type SvFitCalloutVariant,
} from "./components/fit-score/sv-fit-callout.js";
export { SvFitScore, type SvFitScoreProps } from "./components/fit-score/sv-fit-score.js";
export { SvGlass, type SvGlassProps } from "./components/glass/sv-glass.js";
export {
  SV_ICON_NAMES,
  SV_ICON_SIZES,
  SvIcon,
  type SvIconName,
  type SvIconProps,
  type SvIconSize,
} from "./components/icon/sv-icon.js";
export {
  SV_SCREEN_PANEL_ALIGNS,
  SV_SCREEN_PANEL_MODES,
  SvScreen,
  type SvScreenNavigation,
  type SvScreenPanelAlign,
  type SvScreenPanelMode,
  type SvScreenProps,
} from "./components/screen/sv-screen.js";
export {
  SV_SPINNER_SIZES,
  SvSpinner,
  type SvSpinnerProps,
  type SvSpinnerSize,
} from "./components/spinner/sv-spinner.js";
export { defineSvElements } from "./register.js";
export {
  SvVariantPicker,
  type SvSelectDetail,
  type SvStockNoticeDetail,
  type SvVariantPickerProps,
} from "./components/variant-picker/sv-variant-picker.js";
export {
  SvFactList,
  type SvFact,
  type SvFactListProps,
} from "./components/fact-list/sv-fact-list.js";
export {
  SV_HEIGHT_INPUT_MODES,
  SvHeightInput,
  type SvHeightInputMode,
  type SvHeightInputProps,
} from "./components/height-input/sv-height-input.js";
export {
  SvHistoryChip,
  type SvHistoryChipProps,
} from "./components/history-chip/sv-history-chip.js";
export {
  SV_MESSAGE_LAYOUTS,
  SV_MESSAGE_VARIANTS,
  SvMessage,
  type SvMessageLayout,
  type SvMessageProps,
  type SvMessageVariant,
} from "./components/message/sv-message.js";
export {
  SvCamera,
  type SvCameraCapture,
  type SvCameraProps,
} from "./components/camera/sv-camera.js";
export { SvImage, type SvImageProps } from "./components/image/sv-image.js";
export { SvPhotoGuide } from "./components/photo-guide/sv-photo-guide.js";
export { SvPoweredBy } from "./components/powered-by/sv-powered-by.js";
export { SvSteps, type SvStepsProps } from "./components/steps/sv-steps.js";
export {
  SvStyleToggle,
  type SvStyleToggleProps,
} from "./components/style-toggle/sv-style-toggle.js";
export { type SvChangeDetail } from "./events.js";
export {
  SvSessionIntroScreen,
  type SvSessionIntroScreenProps,
  type SvSessionIntroChangeDetail,
  type SvSessionIntroActionDetail,
} from "./screens/sv-session-intro-screen.js";
export {
  ui,
  createUiContext,
  SvUiContext,
  type SvUiOptions,
  type SvUiSnapshot,
  type SvAppearance,
} from "./ui/index.js";
export { type SvImageCrop } from "./media/image-crop.js";
export { type SvImageFraming } from "./media/image-framing.js";
export {
  SvPhotoCaptureScreen,
  SV_PHOTO_CAPTURE_STATES,
  type SvPhotoCaptureState,
  type SvPhotoCaptureScreenProps,
  type SvPhotoCaptureActionDetail,
} from "./screens/sv-photo-capture-screen.js";
export {
  SvPhotoUploadRejectedScreen,
  type SvPhotoUploadRejectedScreenProps,
  type SvPhotoUploadRejectedActionDetail,
} from "./screens/sv-photo-upload-rejected-screen.js";
export {
  SvHeightSettingScreen,
  type SvHeightSettingScreenProps,
  type SvHeightSettingChangeDetail,
  type SvHeightSettingActionDetail,
} from "./screens/sv-height-setting-screen.js";
export { SvTryOnViewScreen } from "./screens/sv-try-on-view-screen.js";
export {
  SV_TRY_ON_VIEW_STATES,
  type SvTryOnViewState,
  type SvTryOnViewScreenProps,
  type SvTryOnViewActionDetail,
  type SvTryOnViewChangeDetail,
} from "./screens/try-on-view/types.js";
export type { SvTryOnFit, SvTryOnFitCallout } from "./screens/try-on-view/fit.js";
export {
  SvPhotoRetakeDialog,
  type SvPhotoRetakeDialogProps,
  type SvPhotoRetakeActionDetail,
} from "./screens/sv-photo-retake-dialog.js";
export type { SvVariantCommerce, SvStockNotice } from "./commerce/types.js";

export type { SvFieldAccessibilityProps } from "./internal/field-accessibility.js";
