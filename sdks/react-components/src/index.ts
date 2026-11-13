// Pulls the base stylesheet (Tailwind utilities + design tokens + global
// rules) into the Vite build graph. Vite lib mode strips this import from the
// emitted JS and merges the CSS into dist/studio-vaai-components.css — it is a
// build-time signal only, so consumers still load the stylesheet explicitly.
import "./studio-vaai-components.css";

export {
  compileStudioVaaiUiMessages,
  mergeStudioVaaiUiMessagesSource,
  studioVaaiUiMessagesDe,
  studioVaaiUiMessagesEn,
  studioVaaiUiMessagesSourceDe,
  studioVaaiUiMessagesSourceEn,
  studioVaaiUiMessagesForLocale,
  type PartialStudioVaaiUiMessagesSource,
  type StudioVaaiUiLocale,
  type StudioVaaiUiMessages,
  type StudioVaaiUiMessagesSource,
} from "./i18n/index.js";
export {
  StudioVaaiUiProvider,
  useStudioVaaiUi,
  type StudioVaaiUi,
  type StudioVaaiUiProviderProps,
} from "./studio-vaai-ui-provider.js";
// The single derivation of "which sizes does the flow refuse". Exported because a HOST renders
// its own size chips too — the demo's PDP does — and a second copy of this logic drifts from
// this one the moment either changes. It already had: the PDP kept mapping the `too_loose`
// outlook onto a refusal after the SDK stopped, so a shopper saw XL–3XL struck on the page and
// only 3XL struck in the try-on, one tap apart, off identical data.
export {
  buildSizeGates,
  resolveGateAlternative,
  type SizeGate,
  type SizeGateFailure,
  type SizeGateRecommendation,
} from "./batteries/size-gates.js";
export { useSurfaceLandmarks } from "./surface-landmarks-context.js";
export type {
  StudioVaaiUiComponentOverrides,
  TryOnImageOverlayProps,
} from "./studio-vaai-ui-component-overrides-types.js";
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
} from "./ui/surface-landmarks.js";
export {
  DefaultFlowSheetMount,
  type DefaultFlowSheetMountProps,
} from "./ui/default-flow-sheet-mount.js";
export {
  StudioVaaiDefaultFlow,
  type StudioVaaiDefaultFlowClassNames,
  type StudioVaaiDefaultFlowHandle,
  type StudioVaaiDefaultFlowProps,
  type StudioVaaiTryOnRenderInput,
  type StudioVaaiTryOnVariantInput,
} from "./studio-vaai-default-flow.js";
export type { SheetShellClassNames } from "./ui/sheet-shell-class-names.js";
export {
  TryOnViewScreen,
  type TryOnViewCarouselSlide,
  type TryOnViewScreenProps,
} from "./batteries/try-on-view-screen.js";
export { ActionsSection, type ActionsSectionProps } from "./ui/actions-section.js";
export { GuideGraphic, type GuideGraphicProps } from "./ui/guide-graphic.js";
export { ImageView, type ImageViewProps } from "./ui/image-view.js";
export { PoweredBy, type PoweredByProps } from "./ui/powered-by.js";
export { readFitUiQueryFlag, useFitUiFlag } from "./utils/use-fit-ui-flag.js";
export { StudioVaaiRoot, type StudioVaaiRootProps } from "./ui/studio-vaai-root.js";
export type {
  SvColorToken,
  SvFontToken,
  SvRadiusToken,
  SvSpaceToken,
  SvToken,
  SvTokenOverrides,
} from "./generated/tokens.js";
