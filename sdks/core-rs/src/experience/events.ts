import type {
  ProductId,
  TryOnId,
  TryOnRequestId,
  VariantId,
} from "../../build/wasm2/state_machine.js";

export type TryOnExperienceStep =
  | "intro"
  | "camera"
  | "photo-upload"
  | "photo-rejected"
  | "height"
  | "variant-selection"
  | "try-on";

export interface TryOnExperienceEntry {
  entry?: string;
  subentry?: string;
}

type PhotoSource = "library" | "camera";
type BackendFailure =
  | "invalid-request"
  | "not-found"
  | "body-not-found"
  | "unusable"
  | "internal"
  | "unavailable";
type PhotoRejection =
  | "no-human-detected"
  | "human-occluded"
  | "human-not-standing"
  | "human-too-small"
  | "inappropriate-clothing";
type DeviceFailure = "permission-denied" | "unavailable" | "interrupted" | "failed";
type SizeRefusal = "garment-too-small" | "garment-too-large";

interface Context {
  readonly productId: ProductId;
  readonly step: TryOnExperienceStep;
}
interface Variant {
  readonly variantId: VariantId;
  readonly foreignIds: Readonly<Record<string, string>>;
}
interface Request {
  readonly requestId: TryOnRequestId;
  readonly variantId: VariantId;
}
interface Result {
  readonly tryOnId: TryOnId;
  readonly variantId: VariantId;
}

interface Details {
  "sv-try-on-opened": Readonly<TryOnExperienceEntry>;
  "sv-try-on-closed": { readonly displayed?: Result };
  "sv-try-on-step-changed": { readonly previousStep?: TryOnExperienceStep };
  "sv-try-on-consent-granted": unknown;
  "sv-try-on-session-failed": { readonly reason: BackendFailure };
  "sv-try-on-photo-source-started": {
    readonly source: PhotoSource;
    readonly originStep: TryOnExperienceStep;
  };
  "sv-try-on-photo-source-cancelled": {
    readonly source: PhotoSource;
    readonly originStep: TryOnExperienceStep;
  };
  "sv-try-on-photo-processing": { readonly source: PhotoSource };
  "sv-try-on-photo-accepted": { readonly source: PhotoSource };
  "sv-try-on-photo-rejected": { readonly source: PhotoSource; readonly reason: PhotoRejection };
  "sv-try-on-photo-failed": { readonly source: PhotoSource; readonly reason: BackendFailure };
  "sv-try-on-height-confirmed": unknown;
  "sv-try-on-height-failed": { readonly reason: BackendFailure };
  "sv-try-on-operation-uncertain": { readonly work: "photo" | "height" | "try-on" };
  "sv-try-on-picker-failed": { readonly reason: DeviceFailure };
  "sv-try-on-camera-failed": {
    readonly phase: "acquire" | "stream";
    readonly reason: DeviceFailure;
  };
  "sv-try-on-capture-failed": { readonly reason: DeviceFailure };
  "sv-try-on-variant-changed": Variant;
  "sv-try-on-requested": Request & Variant & { readonly origin: "shopper" | "automatic" };
  "sv-try-on-request-resolved": Request & Result;
  "sv-try-on-rendered": Result;
  "sv-try-on-presented": Result;
  "sv-try-on-refused": Request & { readonly reason: SizeRefusal };
  "sv-try-on-failed": Request & { readonly reason: BackendFailure | "inadmissible" };
  "sv-try-on-detached": Request & { readonly stage: "waiting" | "rendering" | "uncertain" };
  "sv-try-on-add-to-cart-requested": Variant;
}

export type TryOnExperienceEventMap = {
  [Name in keyof Details]: Context & Details[Name];
};

/** Facts delivered in order once their effects have been acknowledged. */
export type TryOnExperienceEvent = {
  [Name in keyof TryOnExperienceEventMap]: {
    readonly type: Name;
    readonly detail: TryOnExperienceEventMap[Name];
  };
}[keyof TryOnExperienceEventMap];
