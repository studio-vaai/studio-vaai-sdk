import type { ApiResult, CallOptions } from "../base.js";
import type { BodyId, ProductId, SessionHandle, TryOnId } from "../types.js";

/**
 * A rejected size. `recommendedSize` is the size to try instead: its key in the shop's ids
 * ({@link sizeKeyOf}), always one the shop sells; empty when the shop sells no size in that
 * direction.
 */
export type TryOnFailureReason =
  | { kind: "garment_too_small"; recommendedSize: string }
  | { kind: "garment_too_large"; recommendedSize: string };

/**
 * Scene metadata surfaced alongside a successful try-on. Today only carries
 * `overlayColor` — the lowercase `#RRGGBB` hex the SDK paints over try-on
 * imagery (carousel chevrons, pagination dots, historical-height labels) so
 * in-image chrome reads as a sibling of the brand-configured Scene rather
 * than fighting it. Extends naturally as more scene-derived view fields ship.
 */
export interface TryOnScene {
  overlayColor: string;
}

/**
 * Where one fit-panel dimension sits in the try-on image — projected server-side through the
 * exact camera the composite was rendered with, so the point lands pixel-exact on the anatomy.
 * Coordinates are normalized 0–1 relative to the full image (x right, y down); only in-frame
 * anchors ship. Draw a callout dot here and a leader line to the matching fit-check card.
 */
export interface FitAnchor {
  /** Body-dimension slug matching {@link FitCheck.dimension}: `"chest" | "waist" | "sleeve_length" | "total_length"`. */
  dimension: string;
  /** `"left"` / `"right"` for paired anchors (sleeves); absent for central ones. */
  side?: string;
  /** Normalized x in the output image (0 = left edge, 1 = right edge). */
  x: number;
  /** Normalized y in the output image (0 = top edge, 1 = bottom edge). */
  y: number;
}

/**
 * Where a try-on came from: the body, piece and size it rendered, the publication and stored drape
 * it used, and the builds that produced it. Ids, hashes, timestamps and image tags only. Not the
 * C2PA manifest, which travels inside the image.
 */
export interface TryOnProvenance {
  bodyId: string;
  productId: string;
  pieceId: string;
  /** Storefront size slug (`27-l30`, `s`). */
  sizeSlug: string;
  /** blake3 (hex) of the publication manifest the piece pointed at when the try-on ran. */
  manifestHash?: string;
  /** The publication's size (realization) id, decimal. */
  realizationId?: string;
  /** blake3 (hex) of the stored drape the render used. */
  bakeHash?: string;
  /** `int`, `prod`, `dev`. */
  environment?: string;
  /** API server build (image tag, a commit) that ran the try-on. */
  apiBuild?: string;
  /** Inference build (image tag, a commit) that rendered the image. */
  inferenceBuild?: string;
  /** RFC 3339. */
  createdAt: string;
  /** RFC 3339. */
  resolvedAt?: string;
}

export type TryOnResult =
  | {
      status: "success";
      tryOnId: TryOnId;
      /** The variant that was tried on; absent when it has since been retired. */
      variantId?: string;
      imageUrl: string;
      scene: TryOnScene;
      /** Callout anchors for this try-on's image; absent when the render produced none in frame. */
      fitAnchors?: readonly FitAnchor[];
      /** Where this render came from (see {@link TryOnProvenance}). */
      provenance?: TryOnProvenance;
    }
  | { status: "error"; reason: TryOnFailureReason };

export interface GetRecommendedSizeArgs {
  session: SessionHandle;
  bodyId: BodyId;
  productId: ProductId;
}

export interface CreateTryOnArgs {
  session: SessionHandle;
  bodyId: BodyId;
  productId: ProductId;
  /** `id` of one of the product's variants (`ProductDetails.variants`). */
  variantId: string;
}

export interface GetTryOnArgs {
  session: SessionHandle;
  tryOnId: TryOnId;
}

/**
 * One assessed measurement of one size: how the garment's authored chart value relates to the
 * shopper's measured body — a traffic-light row of a fit-check panel. Only girth columns the body
 * pipeline measures (chest, waist) are emitted.
 */
export interface FitCheck {
  /** The chart column id (e.g. `"chest_width"`). */
  pointId: string;
  /** The brand-authored column label (e.g. `"Chest Width"`). */
  label: string;
  /** Stable body-dimension slug for icon mapping: `"chest" | "waist" | "hip" | …`. */
  dimension: string;
  /** Garment circumference at this size (mm). */
  garmentMm: number;
  /** The shopper's matching body circumference (mm). */
  bodyMm: number;
  /** Ease: garment − body (mm). Negative = smaller than the body. */
  easeMm: number;
  /**
   * Signed distance from the fit profile's ideal ease, in tolerance units (≈ one grade step).
   * `0` = exactly the intended ease; `±1` = the edge of the intended band.
   */
  easeNorm: number;
  /**
   * Where the intended-fit band's center sits relative to the baseline intent (girths: the
   * regular-fit ideal; lengths: the global wrist/mid-hip defaults), in the same tolerance units
   * (positive = more ease / longer). Continuous when the chart carries a fit model (the brand's
   * demonstrated intent); otherwise one of four profile positions, and `0` for length checks. A
   * dot at `idealShiftNorm + easeNorm` from the axis center sits on the absolute scale.
   */
  idealShiftNorm: number;
  /**
   * Residual uncertainty of the intent estimate, in the same tolerance units: `0` for bucket-only
   * charts, small when several fit models corroborate, large when they conflict. Rendered as a
   * soft fringe extending the intended-fit band by ±intentSigmaNorm (with the solid band narrowed
   * to √(1 − intentSigmaNorm²)), so thin calibration LOOKS uncertain.
   */
  intentSigmaNorm: number;
  /** Traffic-light verdict: `"too_small" | "runs_tight" | "ideal" | "runs_loose" | "too_loose"`. */
  fit: string;
  /** Human-readable English sentence; clients typically localize from `fit` instead. */
  sentence: string;
}

/** One ranked size suggestion from the brand size chart, best first. */
export interface SizeRecommendation {
  /** The size key in the shop's ids ({@link sizeKeyOf} of {@link options}): `"M"`, `"27 / 30"`. */
  size: string;
  /** 1-based rank; `1` is the best fit. */
  rank: number;
  /** Human-readable rationale, e.g. `"Chest fits with +11 cm ease — relaxed as intended"`. */
  rationale: string;
  /** Machine-readable fit outlook for badge styling: `"too_small" | "runs_tight" | "ideal" | "runs_loose" | "too_loose"`. */
  fit: string;
  /** Shopper-facing 0–100 fit-match percentage (higher = better). */
  fitMatch: number;
  /** Per-measurement fit breakdown for this size (assessed girth columns only), authored column order. */
  fitChecks: readonly FitCheck[];
  /**
   * Present when the try-on HARD gate would reject this size for this body — the same catalog
   * constraints the try-on endpoint enforces, previewed here so UIs can mark the size up front
   * instead of discovering the rejection after a try-on request. Absent = tryable.
   */
  gate?: "too_small" | "too_large";
  /**
   * This size on every axis it is sold by, in the shop's own ids: `{ size: "M" }`, or
   * `{ size: "32", style: "32" }` for waist × length. Never holds `colorway` or `template`.
   */
  options?: Readonly<Record<string, string>>;
}

export interface RecommendedSizeData {
  /**
   * The size key in the shop's ids ({@link sizeKeyOf}) of the best pick, always a size the shopper
   * can actually wear.
   *
   * **Absent when every size is refused.** A body outside the whole ladder has no recommendation;
   * naming one anyway would recommend precisely the size the try-on gate then bounces. Show a
   * "nothing fits these measurements" state rather than preselecting a size — `recommendations`
   * still carries the full ranking, each entry with its own `gate`.
   */
  recommendedSize?: string;
  /**
   * All chart sizes ranked best-first. Empty when the product has no size chart authored. For a
   * product sold along several axes, every published combination: the size axis ranked by girth,
   * the further axes (e.g. length) by how the garment's lengths meet the measured body.
   */
  recommendations: readonly SizeRecommendation[];
  /**
   * The recommended size on every axis it is sold by, in the shop's own ids
   * (`{ size: "32", style: "32" }`). Never holds `colorway` or `template`.
   */
  recommendedOptions?: Readonly<Record<string, string>>;
}

export interface TryOnApi {
  getRecommendedSize(
    args: GetRecommendedSizeArgs,
    options?: CallOptions,
  ): Promise<ApiResult<RecommendedSizeData>>;

  createTryOn(args: CreateTryOnArgs, options?: CallOptions): Promise<ApiResult<TryOnResult>>;

  getTryOn(args: GetTryOnArgs, options?: CallOptions): Promise<ApiResult<TryOnResult>>;
}
