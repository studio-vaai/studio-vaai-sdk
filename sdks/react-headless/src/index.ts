import { defaultStudioVaai } from "./default-studio-vaai.js";

export {
  buildDefaultRootViewModel,
  type DefaultRootPhase,
  type DefaultRootProductPhase,
  type DefaultRootRecommendationUiState,
  type DefaultRootSnapshot,
  type DefaultRootTryOnPipelineUiState,
  type DefaultRootVariantUiState,
  type DefaultRootViewModel,
} from "./default-root-view-model.js";
export {
  createStudioVaaiContext,
  type CreateStudioVaaiContextOptions,
  type CreateStudioVaaiContextResult,
  type StudioVaaiProviderInput,
  type StudioVaaiProviderProps,
  type SubscribeTrackingFn,
} from "./studio-vaai-context.js";
export { defaultStudioVaai } from "./default-studio-vaai.js";
export { useProductTryOnHistory } from "./use-product-try-on-history.js";
export {
  useStudioVaaiAvailability,
  type StudioVaaiAvailabilityStatus,
  type UseStudioVaaiAvailabilityOptions,
  type UseStudioVaaiAvailabilityResult,
} from "./use-studio-vaai-availability.js";
export {
  useStudioVaaiExternalSelection,
  type UseStudioVaaiExternalSelectionArgs,
} from "./use-studio-vaai-external-selection.js";
export { getOrCreateVisitorId } from "./visitor-id.js";
export * from "./errors.js";

export const {
  StudioVaaiProvider,
  useStudioVaaiActor,
  useStudioVaaiClient,
  useStudioVaaiSelector,
  useStudioVaaiTracking,
  useTracking,
} = defaultStudioVaai;
