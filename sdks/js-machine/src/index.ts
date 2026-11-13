export type {
  BodyHeightCalibrationContext,
  BodyHeightCalibrationInput,
  BodyHeightCalibrationOutput,
  BodyHeightRetryCaptureOutput,
  BodyRevision,
  CreateBodyLikeError,
  DefaultRootContext,
  DefaultRootInput,
  FrameLock,
  JsMachineInput,
  CameraFailureKind,
  PhotoCaptureContext,
  PhotoCaptureInput,
  PhotoUploadContext,
  PhotoUploadInput,
  ProductFlowEvent,
  RootNavigationEvent,
  SessionIntroContext,
  SessionIntroInput,
  TryOnFlowProduct,
  TryOnFlowProductAttributeMetadata,
  TryOnFlowProductVariant,
  TryOnProductColorwayOption,
  TryOnProductSizeOption,
  TryOnProductStyleGlyph,
  TryOnProductStyleOption,
  TryOnProductVariantAxis,
  TryOnProductVariantAxisValue,
  TryOnRequestContext,
  TryOnRequestInput,
  TryOnResultContext,
  TryOnResultInput,
  VariantAttributes,
} from "./context/index.js";
export {
  STYLE_ATTRIBUTE_KEY,
  companionStyleSelections,
  findVariantByAttributes,
  frameLockFromCenterCrop,
} from "./context/index.js";
export {
  buildTryOnFlowProduct,
  type BuildTryOnFlowProductInput,
  type ProductAxis,
  type ProductAxisItem,
} from "./try-on-flow-product.js";
export {
  productVariantAxes,
  variantCombinationFor,
  variantForeignIds,
  variantOptionsForSize,
  variantValueAvailable,
} from "./variant-axes.js";
export {
  tryOnColorwayOptionForAttribute,
  tryOnSizeLabelForAttribute,
} from "./try-on-merchandising-helpers.js";
export {
  effectiveRecommendedSize,
  gatePrePivotSize,
} from "./machines/product-overview-parallel.js";
export {
  selectProductTryOnHistory,
  type ProductTryOnHistory,
  type TryOnHistoryEntry,
  type TryOnHistoryEntryStatus,
  type TryOnHistoryFailureReason,
} from "./try-on-history-helpers.js";
export {
  defaultRootMachine,
  type DefaultRootEvent,
  type DefaultRootMachine,
} from "./default-root.js";
// Child machines are composed internally by `defaultRootMachine` and are not
// exported as values. Their event/output/snapshot TYPES stay public:
// they appear transitively in the root snapshot that `useStudioVaaiActor` and
// the selectors expose, so consumers (and emitted `.d.ts`) must be able to name
// them.
export type { SessionIntroEvent, SessionIntroOutput } from "./machines/session-intro.js";
export type {
  PhotoCaptureEvent,
  PhotoCaptureOutput,
  PhotoCaptureSnapshot,
} from "./machines/photo-capture.js";
export type {
  PhotoUploadEvent,
  PhotoUploadOutput,
  PhotoUploadSnapshot,
} from "./machines/photo-upload.js";
export type { BodyHeightCalibrationEvent } from "./machines/body-height-calibration.js";
export type { TryOnRequestOutput } from "./machines/try-on-request.js";
export type { TryOnResultEvent, TryOnResultOutput } from "./machines/try-on-result.js";
export {
  isStandardError,
  transportErrorFromActor,
  unwrapApiFailure,
  type CompanionTryOnOutcome,
  type CreateBodyActorOutput,
  type RestoreSessionOutput,
} from "./actors.js";
export {
  createLocalStorageSessionPersistence,
  createMemorySessionPersistence,
  createNoopSessionPersistence,
  sessionLocalStorageKeyForBasePath,
  type SessionPersistenceAdapter,
} from "./session-persistence.js";
export type { AnalyticsSignal, HostAnalyticsSignal } from "./analytics-signal.js";
export type { ImageFlowSource } from "@studio-vaai/js-tracking";
export { createTrackingSubscriber, stepFromSnapshot, type TrackingSubscriber } from "./tracking.js";
