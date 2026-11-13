import type { BodyId } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { StandardError } from "@studio-vaai/js-client";
import type { TryOnResult } from "@studio-vaai/js-client";
import type { RecommendedSizeData } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";
import type { ImageFlowSource, VariantSelectionVia } from "@studio-vaai/js-tracking";

import type { SessionPersistenceAdapter } from "../session-persistence.js";
import type { TryOnHistoryEntry, TryOnHistoryFailureReason } from "../try-on-history-helpers.js";
import type { PhotoUploadContext } from "./photo-upload.js";
import type {
  BodyRevision,
  JsMachineInput,
  TryOnFlowProduct,
  VariantAttributes,
} from "./shared.js";

/** Full root context: optional `session` / `bodyId` until the global prefix completes. */
export interface DefaultRootContext {
  client: StudioVaaiClient;
  sessionPersistence: SessionPersistenceAdapter;
  session?: SessionHandle | undefined;
  sessionExpiresAt?: string | undefined;
  /**
   * True once consent is effectively established: either the session was restored from
   * persistence (user consented on a prior visit), or the photo upload has completed
   * successfully in this session (body was created from the user's picked image).
   * Stays unset through the busy/uploading state and only flips once the photo
   * upload resolves into `postCapture`. Never cleared once true.
   */
  consentGivenOrRestored: boolean;
  /** Set when choosing an image from `sessionIntro.awaitingImage` (then root enters `photoUpload`). */
  pendingSelectedImage?: PhotoUploadContext["image"];
  /** Last successful capture; used for height-calibration preview until replaced. */
  lastCapturedImage?: PhotoUploadContext["image"];
  bodyId?: BodyId | undefined;
  /** Predicted height (cm) from the last successful {@link BodyApi.createBody}; cleared when the body is reset. */
  bodyPredictedHeightCm?: number | undefined;
  /** Last confirmed height from body calibration; shown on product try-on. */
  bodyHeightCm?: number | undefined;
  /**
   * History of confirmed body revisions, oldest first. A new revision is appended
   * to this list each time `CALIBRATION_DONE` lands a height that differs from
   * the last revision; re-confirming the same height is a no-op. Reset to `[]`
   * alongside `tryOnHistoryByProduct` whenever the body is reset (`OPEN_CAMERA`,
   * `USE_ANOTHER_IMAGE`).
   *
   * Each {@link TryOnHistoryEntry} snapshots `bodyRevisions.length - 1` at append
   * time (see {@link TryOnHistoryEntry.bodyRevisionIndex}) so the UI can walk
   * back from the latest revision to flag entries generated under an older
   * height and label them with the height that produced them. Mirrors the
   * server's `body_revisions` table conceptually.
   */
  bodyRevisions: readonly BodyRevision[];
  /**
   * True from `CALIBRATION_SUBMITTED` until `CALIBRATION_DONE` or
   * `CALIBRATION_FAILED`. Drives the try-on pipeline's `awaitingCalibration`
   * queue so a click is held only while a calibrate request is actually in
   * flight — not when the work region reads `running` after an unrelated
   * product-screen re-enter.
   */
  calibrationInFlight: boolean;
  /**
   * Per-product try-on history with a navigation cursor. `entries` is chronological
   * (newest last) and only grows on a successful try-on. `cursor` indexes into
   * `entries`: `cursor >= 0` selects an entry; `cursor < 0` means "show fallback"
   * (the uploaded photo). After a successful try-on the cursor is moved to the
   * new last index; `RETURN_TO_VARIANT_SELECTION` with `via: "back"` decrements
   * it (floor -1). The whole map
   * is cleared when the session body is reset (new photo / retry capture).
   */
  tryOnHistoryByProduct: Record<string, { entries: TryOnHistoryEntry[]; cursor: number }>;
  product: TryOnFlowProduct;
  selection: VariantAttributes;
  /**
   * One-shot flag: when true, the first time the flow reaches the `product`
   * (variant-selection) screen with a selection that resolves to a variant, it
   * auto-fires `START_TRY_ON` and skips the size picker — for hosts that already
   * know the user's pick (e.g. a PDP where the size was chosen in the shop).
   * Seeded from {@link DefaultRootInput.autoStartOnPreselectedVariant} and
   * consumed (set false) on that first product-screen entry, so manual returns
   * to variant selection (RETURN_TO_VARIANT_SELECTION, RESET_PRODUCT, …) render
   * the picker normally.
   */
  pendingAutoStartTryOn: boolean;
  /**
   * True while `selection.size` is only a host-side *default* (e.g. a PDP that preselects the first
   * size for its Add-to-Cart button) rather than an explicit user pick. While true, the product
   * screen proactively fetches the size recommendation and seeds `selection.size` with the
   * recommended slug; a pending auto-start either waits for that seed
   * ({@link autoStartOnRecommendedSize}) or is spent without starting anything, leaving the
   * shopper on the size-selection screen. Cleared by any explicit pick — a `SELECT_VARIANT` in
   * the sheet or a host `PRODUCT_CHANGED` push — unless the push itself says its size is still a
   * default (`selectedSizeIsDefault`). Seeded from {@link DefaultRootInput.selectedSizeIsDefault}.
   */
  sizeIsDefaultSelection: boolean;
  /**
   * Whether a pending auto-start may fire on a size the shopper never picked (the chart's
   * recommended size, after the seeding fetch). When false — the default — a default-only size
   * consumes the auto-start one-shot WITHOUT starting anything, so the shopper lands on the
   * size-selection screen (with the recommended size pre-seeded) and decides for themself.
   * Seeded from {@link DefaultRootInput.autoStartOnRecommendedSize}.
   */
  autoStartOnRecommendedSize: boolean;
  /**
   * The server's chart-based size recommendation for the active (body, product), fetched proactively
   * on the product screen. `recommendedSize` is the rank-1 slug; `recommendations` carries the ranked
   * shortlist with each pick's rationale + fit outlook. `undefined` until fetched / when the product
   * has no size chart.
   */
  recommendation?: RecommendedSizeData | undefined;
  recommendationError?: StandardError | undefined;
  pendingTryOn?: { result: TryOnResult } | undefined;
  /**
   * The most-recent fit-gate outcome for the active product: a pre-pivot of a gated
   * selection (the machine swapped to the recommendation BEFORE requesting), or a live
   * server rejection (with an auto-pivot re-request when there was somewhere better to
   * go). Carries the size the user asked for, the verdict, and the recommendation so the
   * size-selector battery can render the statement note. Cleared on `SELECT_VARIANT`
   * (manual size change) and on body / product change. See `tryOnPipelineRegion`.
   */
  lastTryOnFailure?:
    | {
        reason: TryOnHistoryFailureReason;
        requestedSize: string;
        recommendedSize: string;
        /**
         * True when the machine pivoted the RENDER to `recommendedSize` on the shopper's
         * behalf (pre-pivot, or a re-request after a server rejection) — UIs then phrase
         * the note in the past tense ("X would be too small — showing you Y"). Absent only
         * when a rejection landed without a pivot; the note is then a present-tense
         * statement ("Y should fit" — the selection has already jumped there). Never a
         * question.
         */
        autoPivoted?: boolean;
      }
    | undefined;
  /**
   * Set when the user tapped "use another image" from a specific screen.
   * Root re-enters `photoUpload`, but the UI keeps rendering this originating screen
   * (with `busy` during upload). Cleared on photoUpload success or CANCEL_USE_ANOTHER_IMAGE.
   */
  useAnotherImageSource?: "photoUpload" | "bodyHeightCalibration" | "product" | undefined;
  /**
   * Where the current image originated. Set when a new image is introduced
   * via the gallery picker (`IMAGE_SELECTED`, `USE_ANOTHER_IMAGE`) or via the
   * camera flow (`photoCapture` completion). Stays set across the rest of the
   * session so UI / back-handling can route based on origin (e.g. during the
   * post-capture upload the camera path should keep showing the captured
   * preview rather than bouncing back to the session-intro upload screen).
   */
  photoSource?: "camera" | "gallery" | undefined;
  /**
   * Last rejection from the `photoUpload` child — image + error captured the moment
   * the child entered its `rejected` state. Survives the child teardown that happens
   * on `USE_ANOTHER_IMAGE` so the UI can keep showing the rejected preview and the
   * specific error during the retry window. Cleared on photoUpload success.
   */
  lastPhotoRejection?:
    | {
        image: NonNullable<PhotoUploadContext["image"]>;
        error: NonNullable<PhotoUploadContext["lastError"]>;
      }
    | undefined;
  /**
   * Error from the most-recent failed height calibration (`CALIBRATION_FAILED`).
   * Held at the root — not read off the bodyHeight child's transient `failed`
   * state — because landing back on the height screen re-syncs the picker, which
   * dispatches `SET_HEIGHT` and flips the child `failed -> editing`, clearing its
   * error before the UI can show it. Survives that here. Cleared on the next
   * `CALIBRATION_SUBMITTED` (retry), `CALIBRATION_DONE` (success), and on
   * `USE_ANOTHER_IMAGE` (fresh calibration flow).
   */
  lastCalibrationError?: StandardError | undefined;
  /**
   * Staged by {@link RETURN_TO_VARIANT_SELECTION} and consumed on the next
   * `product` screen entry emit as `variant-selection-initiated.via`.
   */
  variantSelectionVia?: VariantSelectionVia | undefined;
  /**
   * Entry point for the in-flight gallery upload or camera capture. Set by
   * {@link INITIATE_IMAGE_UPLOAD} / {@link OPEN_CAMERA}; consumed by abort
   * emits and cleared on success or cancel.
   */
  imageFlowSource?: ImageFlowSource | undefined;
}

/**
 * Cross-phase navigation: `BACK_TO_HEIGHT`, `USE_ANOTHER_IMAGE` (return to `photoUpload` for a new photo).
 * Product reset is `RESET_PRODUCT` (see `ProductFlowEvent`).
 *
 * The `CALIBRATION_*` events are sent up by the {@link bodyHeightCalibrationMachine} child to coordinate
 * the parallel `postCapture.work` / `postCapture.screen` regions: SUBMITTED advances the screen to
 * `product`, DONE marks the work region ready (unblocking try-on), FAILED yanks the screen back to
 * `heightCalibration` for retry.
 */
export type RootNavigationEvent =
  | { type: "BACK_TO_HEIGHT" }
  | {
      type: "USE_ANOTHER_IMAGE";
      source: "photoUpload" | "bodyHeightCalibration" | "product";
    }
  /** Back out of a "use another image" flow to the originating screen. */
  | { type: "CANCEL_USE_ANOTHER_IMAGE" }
  /** From photo rejection: return to intro (guide) while keeping the session; consent stays hidden. */
  | { type: "RETURN_TO_SESSION_INTRO_FOR_GUIDE" }
  /**
   * Leave the try-on result screen and re-enter variant selection. Emits
   * `variant-selection-initiated` with `via` on the product screen entry.
   */
  | { type: "RETURN_TO_VARIANT_SELECTION"; via: VariantSelectionVia }
  | {
      type: "IMAGE_SELECTED";
      image: NonNullable<PhotoUploadContext["image"]>;
    }
  /**
   * User tapped a gallery-upload CTA and the host is opening the system file
   * picker. Emits `image-upload-initiated` — mirrors {@link OPEN_CAMERA} for
   * the camera path. Does not change machine state.
   */
  | { type: "INITIATE_IMAGE_UPLOAD"; source: ImageFlowSource }
  /**
   * Enter the browser-camera flow. Hosts emit this when the user picks a
   * camera CTA. Gallery upload remains the default; this is an additive entry
   * point.
   */
  | { type: "OPEN_CAMERA"; source: ImageFlowSource }
  /** Back out of the camera flow to `sessionIntro.awaitingImage`. */
  | { type: "CANCEL_CAMERA" }
  /**
   * User dismissed the gallery upload they started — file-picker cancel, or
   * abort of an in-flight `photoUpload`. Emits `image-upload-aborted`; the
   * latter also routes back to `awaitingImage` when applicable.
   */
  | { type: "CANCEL_UPLOAD"; source?: ImageFlowSource }
  /**
   * Attach a JPEG `previewBlob` to the in-flight image once HEIC→JPEG conversion (kicked
   * off in parallel with `IMAGE_SELECTED`) finishes. `previewFor` identifies the source
   * Blob/File so the handler can skip if the user picked a different file mid-flight.
   */
  | { type: "ATTACH_PREVIEW_BLOB"; previewFor: Blob | File; previewBlob: Blob }
  | { type: "CALIBRATION_SUBMITTED" }
  | { type: "CALIBRATION_DONE"; bodyId: BodyId; heightCm: number }
  | { type: "CALIBRATION_FAILED"; error: StandardError }
  /**
   * The server terminally rejected the session (`session_expired` error kind:
   * 60-min inactivity expiry or retention-sweep deletion). Raised internally
   * when any API error path sees that kind; hosts may also dispatch it (e.g.
   * from a local idle timer). The root clears all session-derived context and
   * the persisted handle, then returns to `sessionIntro` for fresh consent.
   */
  | { type: "SESSION_EXPIRED" };

/**
 * Product-screen events handled by the `product` parallel region (variant selection,
 * size recommendation, and the try-on pipeline). Combined with {@link RootNavigationEvent}
 * to form `DefaultRootEvent`.
 */
export type ProductFlowEvent =
  | { type: "SELECT_VARIANT"; selection: VariantAttributes }
  | {
      type: "PRODUCT_CHANGED";
      product: TryOnFlowProduct;
      selection: VariantAttributes;
      /**
       * Whether `selection.size` is only the host's default, as in
       * {@link DefaultRootInput.selectedSizeIsDefault}. A host that keeps one actor across its
       * product pages sends it with every page, since each page has its own. Omitted, a push for
       * the same product counts as the shopper's pick and one for another product keeps the flag.
       */
      selectedSizeIsDefault?: boolean;
    }
  | { type: "RECOMMENDATION_REQUEST" }
  | { type: "DISMISS_RECOMMENDATION" }
  | { type: "RETRY_RECOMMENDATION" }
  | { type: "RESET_PRODUCT" }
  | { type: "START_TRY_ON" };

export interface DefaultRootInput extends JsMachineInput {
  product: TryOnFlowProduct;
  /**
   * Optional initial attribute selection. Hosts that already know the user's pick
   * (e.g. a PDP with a preselected colorway/size) supply it; otherwise the machine
   * starts with an empty selection (`{}`) and the in-sheet variant region stays
   * in `selecting` until the user picks something that resolves to a variant.
   */
  selection?: VariantAttributes | undefined;
  /**
   * Skip the in-sheet size/variant picker when the host already knows the pick.
   * When true and the initial {@link selection} resolves to a variant, the flow
   * auto-triggers the try-on as soon as the user has uploaded a photo and
   * confirmed their height — the product screen is never shown. Defaults to
   * false (the user picks the size in the sheet). See
   * {@link DefaultRootContext.pendingAutoStartTryOn}.
   */
  autoStartOnPreselectedVariant?: boolean | undefined;
  /**
   * Mark the initial {@link selection}'s size as a host-side *default* rather than an explicit user
   * pick (e.g. a PDP that preselects the first size for Add-to-Cart, while the shopper never chose).
   * When true, the product screen fetches the chart-based size recommendation and re-seeds
   * `selection.size` with the recommended slug (surfacing the rationale). A pending
   * {@link autoStartOnPreselectedVariant} try-on does NOT fire for a default-only size — the flow
   * shows the size-selection screen instead — unless {@link autoStartOnRecommendedSize} opts into
   * auto-rendering the recommended size. An explicit pick (in-sheet or a host `PRODUCT_CHANGED`)
   * disables the seeding for good. Defaults to false (the size is treated as the user's own choice
   * and never overridden).
   */
  selectedSizeIsDefault?: boolean | undefined;
  /**
   * Allow a pending {@link autoStartOnPreselectedVariant} try-on to fire even when the size was
   * only a host default ({@link selectedSizeIsDefault}): the one-shot then waits for the size
   * recommendation and auto-renders the RECOMMENDED size. Fit-intelligence hosts opt in; the
   * default is false — a size the shopper never picked starts nothing, and the flow lands on
   * the size-selection screen (pre-seeded with the recommendation) instead. Irrelevant when the
   * selection was an explicit shopper pick — that auto-start never waits on this flag.
   */
  autoStartOnRecommendedSize?: boolean | undefined;
  /** When omitted, {@link defaultRootMachine} uses no-op persistence (tests / SSR). */
  sessionPersistence?: SessionPersistenceAdapter | undefined;
}
