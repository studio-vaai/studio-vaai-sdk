import type { ApiResult, BodyValidationCode, CallOptions } from "../base.js";
import type { BodyId, ProductId, SessionHandle } from "../types.js";

/** For {@link BodyApi.createBody}. On Node without `File`, prefer the `bytes` variant. */
export type ImageInput =
  | { type: "blob"; blob: Blob }
  | { type: "file"; file: File }
  | {
      type: "bytes";
      data: ArrayBuffer | Uint8Array;
      mimeType: string;
    };

export interface InitialBodySummary {
  bodyId: BodyId;
  createdAt: string;
  /** Height estimated from the uploaded image. */
  estimatedHeightCm: number;
  sourceImageUrl: string;
  sourceImageUrlExpiresAt: string;
}

export interface BodySummary extends InitialBodySummary {
  userProvidedHeightCm?: number;
}

export type Body = BodySummary;

export interface ListBodiesArgs {
  session: SessionHandle;
}

export interface ListBodiesData {
  bodies: BodySummary[];
}

/**
 * Camera metadata from the *original* (pre-resize) image. Supply this when you
 * downscale before upload — a client-side resize strips embedded EXIF, and the
 * server needs the original dimensions + EXIF to keep focal-length estimation
 * correct. Optional: omit it (or upload the original) and the server falls back
 * to EXIF embedded in the uploaded bytes. See {@link readCameraMetadata}.
 */
export interface ImageMetadataInput {
  /** Pre-resize width in pixels. */
  originalWidth: number;
  /** Pre-resize height in pixels. */
  originalHeight: number;
  /**
   * Width in pixels of the image actually uploaded (after your resize). The
   * server expresses the focal length at this resolution, so set it whenever
   * you resize yourself; `createBody`'s built-in downscale fills it
   * automatically. When omitted, the upload is assumed to be at the original
   * dimensions.
   */
  uploadedWidth?: number;
  /** Height in pixels of the image actually uploaded (after your resize). */
  uploadedHeight?: number;
  /** EXIF FocalLength, in millimetres. */
  focalLengthMm?: number;
  /** EXIF FocalLengthIn35mmFilm (35mm-equivalent focal length, mm). */
  focalLength35mm?: number;
  /** EXIF FocalPlaneXResolution (pixels per FocalPlaneResolutionUnit). */
  focalPlaneXResolution?: number;
  /** EXIF FocalPlaneYResolution. */
  focalPlaneYResolution?: number;
  /** EXIF FocalPlaneResolutionUnit (2 = inch, 3 = cm). */
  focalPlaneResolutionUnit?: number;
}

export interface CreateBodyArgs {
  session: SessionHandle;
  image: ImageInput;
  /** Original-image camera metadata; see {@link ImageMetadataInput}. */
  imageMetadata?: ImageMetadataInput;
}

export interface BodyCreated {
  body: Body;
  /** Model-predicted height (cm) from the uploaded image; initial value for height calibration. */
  heightCm: number;
}

/**
 * Why a `createBody` call could not produce a usable body.
 *
 * Only `validation` reaches this type: system/infrastructure failures are surfaced as
 * `{ ok: false }` with a {@link StandardError}, never as a typed terminal-failed body.
 * Localize UI from `code`; `message` is a server-supplied fallback.
 */
export interface BodyValidationFailure {
  kind: "validation";
  code: BodyValidationCode;
  message?: string;
}

export type BodyCreateResult =
  | { status: "ready"; created: BodyCreated }
  | { status: "failed"; failure: BodyValidationFailure };

export interface SetBodyHeightArgs {
  session: SessionHandle;
  bodyId: BodyId;
  heightCm: number;
  /**
   * Optional. When set, the server speculatively prewarms the body-for-product
   * (background-removed input) so a subsequent {@link TryOnApi.createTryOn}
   * for this product hits a warm cache. Fire-and-forget on the server — the
   * response does not wait for prewarm to finish.
   */
  productId?: ProductId | undefined;
}

export type SetBodyHeightData = Record<string, never>;

export interface BodyApi {
  listBodies(args: ListBodiesArgs, options?: CallOptions): Promise<ApiResult<ListBodiesData>>;

  createBody(args: CreateBodyArgs, options?: CallOptions): Promise<ApiResult<BodyCreateResult>>;

  setBodyHeight(
    args: SetBodyHeightArgs,
    options?: CallOptions,
  ): Promise<ApiResult<SetBodyHeightData>>;
}
