export { ApiFailureError, StudioVaaiClientNotImplementedError } from "./errors.js";
export type {
  Body,
  BodyApi,
  BodyCreated,
  BodyCreateResult,
  BodySummary,
  InitialBodySummary,
  BodyValidationFailure,
  SetBodyHeightArgs,
  SetBodyHeightData,
  ImageMetadataInput,
  CreateBodyArgs,
  ImageInput,
  ListBodiesArgs,
  ListBodiesData,
} from "./api/body.js";
export { readCameraMetadata } from "./camera-metadata.js";
export { inspectImageHeader, ImageInputError } from "./image-limits.js";
export type { HeaderDimensions } from "./image-limits.js";
export type {
  CatalogApi,
  GetProductByForeignIdArgs,
  GetProductDetailsArgs,
  ListingProvenance,
  ListingSizeProvenance,
  ListingTemplateProvenance,
  ProductDetails,
  ProductVariant,
} from "./api/catalog.js";
export type {
  ExperimentsApi,
  EvaluationContext,
  FlagEvaluation,
  FlagEvaluationFailure,
  BulkEvaluationData,
  GetTryOnDecisionArgs,
  TryOnExperimentDecision,
} from "./api/experiments.js";
export { convertHeicToJpeg } from "./heic.js";
export type {
  ApiFailure,
  ApiResult,
  ApiSuccess,
  BodyValidationCode,
  CallOptions,
  ResultMeta,
  StandardError,
  StandardErrorKind,
} from "./base.js";
export { asBodyValidationCode } from "./base.js";
export type { ClientConfig, StudioVaaiClient, SessionActivity } from "./client.js";
export {
  API_VERSION,
  CLIENT_VERSION_HEADER_VALUE,
  createClient,
  HEADER_CLIENT_VERSION,
  SDK_PACKAGE_ID,
} from "./client.js";
export { installClientInterceptor, applyClientInterceptors } from "./client-interceptors.js";
export type { FetchStudioVaaiClientConfig } from "./impl/fetch-studio-vaai-client.js";
export { createFetchStudioVaaiClient } from "./impl/fetch-studio-vaai-client.js";
export type { GetHealthArgs, HealthCheckData as HealthStatusData, MetaApi } from "./api/meta.js";
export { sizeKeyOf } from "./size-key.js";
export type { BodyId, ProductId, SessionHandle, TryOnId } from "./types.js";
export type {
  CreateSessionArgs,
  GetSessionArgs,
  InvalidateSessionArgs,
  InvalidateSessionData,
  RefreshSessionArgs,
  SessionApi,
  SessionData,
  SessionTransport,
  SessionTransportPreference,
} from "./api/session.js";
export type {
  CreateTryOnArgs,
  FitAnchor,
  FitCheck,
  GetRecommendedSizeArgs,
  GetTryOnArgs,
  RecommendedSizeData,
  SizeRecommendation,
  TryOnApi,
  TryOnFailureReason,
  TryOnProvenance,
  TryOnResult,
  TryOnScene,
} from "./api/try-on.js";

export type { AnalyticsClientOptions } from "./client.js";
