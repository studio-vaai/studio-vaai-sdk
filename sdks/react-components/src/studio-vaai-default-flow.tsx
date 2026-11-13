"use client";

import type {
  BodyHeightCalibrationContext,
  BodyRevision,
  ImageFlowSource,
  PhotoUploadContext,
  PhotoUploadSnapshot,
  VariantAttributes,
} from "@studio-vaai/js-machine";
import type { DefaultRootSnapshot } from "@studio-vaai/react-headless";
import type { AnyActorRef } from "xstate";

import { convertHeicToJpeg } from "@studio-vaai/js-client";
import { selectProductTryOnHistory, stepFromSnapshot } from "@studio-vaai/js-machine";
import {
  buildDefaultRootViewModel,
  useStudioVaaiActor,
  useStudioVaaiTracking,
} from "@studio-vaai/react-headless";
import {
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
} from "react";

import type { SvTokenOverrides } from "./generated/tokens.js";
import type {
  PartialStudioVaaiUiMessagesSource,
  StudioVaaiUiLocale,
  StudioVaaiUiMessages,
} from "./i18n/index.js";
import type { StudioVaaiUiComponentOverrides } from "./studio-vaai-ui-component-overrides-types.js";
import type { StudioVaaiTryOnVariantInput } from "./try-on-variant-input.js";
import type { SheetShellClassNames } from "./ui/sheet-shell-class-names.js";
import type { PartialSurfaceLandmarks } from "./ui/surface-landmarks.js";

import { HeightCalibrationScreen } from "./batteries/height-calibration-screen.js";
import { PhotoCaptureMount } from "./batteries/photo-capture-mount.js";
import { PhotoCaptureScreen } from "./batteries/photo-capture-screen.js";
import { PhotoRetakeDialog } from "./batteries/photo-retake-dialog.js";
import { PhotoUploadRejectedScreen } from "./batteries/photo-upload-rejected-screen.js";
import { ProductOverviewScreen } from "./batteries/product-overview-screen.js";
import { SessionIntroScreen } from "./batteries/session-intro-screen.js";
import { TryOnViewScreen, type TryOnViewCarouselSlide } from "./batteries/try-on-view-screen.js";
import { deriveError, isReasonResolved, type InteractionReason } from "./error/derive-error.js";
import { ErrorProvider, type ErrorContextValue } from "./error/error-context.js";
import { bodyFailureMessage } from "./i18n/index.js";
import { formatCentimeters } from "./i18n/number-format.js";
import { StudioVaaiUiProvider, useStudioVaaiUi } from "./studio-vaai-ui-provider.js";
import { tryOnVariantInput } from "./try-on-variant-input.js";
import { DefaultFlowSheetMount } from "./ui/default-flow-sheet-mount.js";
import { firstChildActor } from "./utils/first-child-actor.js";
import { openPhotoLibrary } from "./utils/open-photo-library.js";
import { usePhotoPreviewUrl } from "./utils/use-photo-preview-url.js";

/** Snapshot helpers for {@link useSyncExternalStore} — see hydration comment in flow body. */
const noop = (): void => {
  void 0;
};
function subscribeNoop(): () => void {
  return noop;
}
function getClientTrue(): boolean {
  return true;
}
function getServerFalse(): boolean {
  return false;
}

/**
 * Walk back from the latest body revision to find the first one whose height
 * differs from the latest. Try-on entries pinned at-or-before that revision
 * are "historical" and labeled with the height that produced them. Returns
 * `-1` (nothing historical) when fewer than two revisions exist or every
 * revision shares the latest height.
 *
 * 171 → 174 → 171 (latest 171): cutoff = 1 (the `174` revision), so entries
 * at index 0 and 1 are both labeled even though entry 0 also has h=171.
 */
function historicalRevisionCutoff(bodyRevisions: readonly BodyRevision[]): number {
  const lastIdx = bodyRevisions.length - 1;
  if (lastIdx < 1) {
    return -1;
  }
  const latest = bodyRevisions[lastIdx];
  if (latest === undefined) {
    return -1;
  }
  for (let i = lastIdx - 1; i >= 0; i -= 1) {
    const rev = bodyRevisions[i];
    if (rev !== undefined && rev.bodyHeightCm !== latest.bodyHeightCm) {
      return i;
    }
  }
  return -1;
}

/**
 * True when the sheet is showing {@link TryOnViewScreen}.
 *
 * `requesting` / `resulting` are the obvious cases. `error` counts too — but only once the
 * shopper has at least one completed try-on: the screen then keeps that render on the hero and
 * states the failure inline with a retry, which beats throwing them back to the product overview
 * and losing the result they were looking at. With no completed try-on there is nothing to show,
 * so the overview (which owns the "pick a size and start" affordance) stays the right home.
 */
function isTryOnViewActive(snapshot: DefaultRootSnapshot): boolean {
  const vm = buildDefaultRootViewModel(snapshot);
  if (vm.phase !== "product" || vm.productPhase !== "active") {
    return false;
  }
  if (vm.tryOnPipeline === "requesting" || vm.tryOnPipeline === "resulting") {
    return true;
  }
  if (vm.tryOnPipeline !== "error") {
    return false;
  }
  const { product } = snapshot.context;
  return selectProductTryOnHistory(snapshot.context, product.id).entries.some(
    (e) => e.status === "completed",
  );
}

function tryOnHistorySlides(
  history: ReturnType<typeof selectProductTryOnHistory>,
  bodyRevisions: readonly BodyRevision[],
  locale: string,
): TryOnViewCarouselSlide[] {
  // Only completed try-ons render visually. Failed entries (e.g. `garment_too_small`)
  // remain in history so the size selector can mark blocked pills, but they have no
  // image and don't belong on the carousel.
  const cutoff = historicalRevisionCutoff(bodyRevisions);
  return history.entries
    .filter((e) => e.status === "completed")
    .map((e) => {
      // Callout anchors ride on the slide so the fit panel can draw the visible
      // slide's image↔card leader lines.
      const anchors = {
        ...(e.fitAnchors === undefined ? {} : { fitAnchors: e.fitAnchors }),
        // Lets a host overlay (e.g. a provenance label) name the render on show.
        ...(e.tryOnId === undefined ? {} : { tryOnId: e.tryOnId }),
        ...(e.provenance === undefined ? {} : { provenance: e.provenance }),
      };
      const idx = e.bodyRevisionIndex;
      if (idx === undefined || idx > cutoff) {
        return { src: e.imageUrl, attributes: e.attributes, ...anchors };
      }
      const rev = bodyRevisions[idx];
      if (rev === undefined) {
        return { src: e.imageUrl, attributes: e.attributes, ...anchors };
      }
      return {
        src: e.imageUrl,
        attributes: e.attributes,
        bottomRightLabel: formatCentimeters(locale, rev.bodyHeightCm),
        ...anchors,
      };
    });
}

function resolveSessionIntroErrorKind(
  sessionIntroSnap: { value?: unknown } | null | undefined,
  photoSnap: PhotoUploadSnapshot | null,
): "createSession" | "upload" | undefined {
  if (sessionIntroSnap?.value === "failed") {
    return "createSession";
  }
  if (photoSnap?.value === "uploadFailed") {
    return "upload";
  }
  return undefined;
}

/**
 * Translate a `createBody` flow error into a user-facing message.
 *
 * Validation rejections (`{ kind: "validation", code }`) are localized via the i18n
 * `bodyFailure` group keyed by `code`, so the user sees a tailored explanation. All
 * other errors (transport, system 5xx, unknown shapes) fall through to `undefined`,
 * letting the caller pick a generic fallback (e.g. `photoUpload.fallbackError`).
 */
function photoUploadErrorMessage(
  err: PhotoUploadContext["lastError"],
  ui: StudioVaaiUiMessages,
): ReactNode {
  if (err === undefined) {
    return undefined;
  }
  if (typeof err === "object" && err !== null && "kind" in err) {
    const { kind } = err as { kind?: unknown };
    if (kind === "validation" && "code" in err) {
      const { code } = err as { code?: unknown };
      if (typeof code === "string") {
        return bodyFailureMessage(ui, code as Parameters<typeof bodyFailureMessage>[1]);
      }
    }
  }
  return undefined;
}

function usePhotoUploadChildSnapshot(child: AnyActorRef | undefined): PhotoUploadSnapshot | null {
  const [snap, setSnap] = useState<PhotoUploadSnapshot | null>(() =>
    child === undefined ? null : (child.getSnapshot() as PhotoUploadSnapshot),
  );

  useEffect(() => {
    if (child === undefined) {
      setSnap(null);
      return;
    }
    setSnap(child.getSnapshot() as PhotoUploadSnapshot);
    const sub = child.subscribe(() => {
      setSnap(child.getSnapshot() as PhotoUploadSnapshot);
    });
    return () => {
      sub.unsubscribe();
    };
  }, [child]);

  return snap;
}

interface SessionIntroChildSnapshot {
  value: string;
}

function useSessionIntroChildSnapshot(
  child: AnyActorRef | undefined,
): SessionIntroChildSnapshot | null {
  const [snap, setSnap] = useState<SessionIntroChildSnapshot | null>(() =>
    child === undefined ? null : (child.getSnapshot() as SessionIntroChildSnapshot),
  );

  useEffect(() => {
    if (child === undefined) {
      setSnap(null);
      return;
    }
    setSnap(child.getSnapshot() as SessionIntroChildSnapshot);
    const sub = child.subscribe(() => {
      setSnap(child.getSnapshot() as SessionIntroChildSnapshot);
    });
    return () => {
      sub.unsubscribe();
    };
  }, [child]);

  return snap;
}

interface BodyHeightCalibrationChildSnapshot {
  value: string;
  context: BodyHeightCalibrationContext;
}

function useBodyHeightCalibrationChildSnapshot(
  child: AnyActorRef | undefined,
): BodyHeightCalibrationChildSnapshot | null {
  const [snap, setSnap] = useState<BodyHeightCalibrationChildSnapshot | null>(() =>
    child === undefined ? null : (child.getSnapshot() as BodyHeightCalibrationChildSnapshot),
  );

  useEffect(() => {
    if (child === undefined) {
      setSnap(null);
      return;
    }
    setSnap(child.getSnapshot() as BodyHeightCalibrationChildSnapshot);
    const sub = child.subscribe(() => {
      setSnap(child.getSnapshot() as BodyHeightCalibrationChildSnapshot);
    });
    return () => {
      sub.unsubscribe();
    };
  }, [child]);

  return snap;
}

export type { StudioVaaiTryOnVariantInput };

/**
 * A completed try-on render, reported to the host as it lands. The `imageUrl` is the same
 * asset the result screen shows, so a host can keep its own gallery of what a shopper has
 * already seen themselves in — the SDK's own history lives in the actor and dies with it.
 */
export interface StudioVaaiTryOnRenderInput extends StudioVaaiTryOnVariantInput {
  /**
   * The render's URL **right now**. Object-storage URLs are presigned and short-lived, so do
   * not persist this and expect it to keep working — store {@link tryOnId} and re-resolve
   * through `getTryOn` when you next need to show the image.
   */
  imageUrl: string;
  /** Stable id for the render. Survives the URL's expiry; use it to fetch a fresh one. */
  tryOnId: string;
}

/** Per-slot `className` overrides for {@link StudioVaaiDefaultFlow}. */
export interface StudioVaaiDefaultFlowClassNames {
  /** Applied to every screen's sheet/modal shell (see {@link SheetShellClassNames}). */
  shell?: SheetShellClassNames;
  /** Applied to the dimmed backdrop behind the sheet/modal. */
  backdrop?: string;
}

export interface StudioVaaiDefaultFlowProps {
  /**
   * Any BCP 47 tag (`de`, `de-AT`, `en-GB`, `fr`); default `en`. Its language picks the shipped
   * catalog (`de` or `en`; other languages use `en`), and number and list formatting follow the
   * full tag. See {@link StudioVaaiUiLocale}.
   */
  locale?: StudioVaaiUiLocale;
  /**
   * MF2 sources deep-merged onto the {@link locale}'s catalog. Pass a complete
   * `StudioVaaiUiMessagesSource` to supply a language the SDK does not ship.
   */
  messages?: PartialStudioVaaiUiMessagesSource;
  /** Optional replacements for studio vaai UI primitives. */
  components?: StudioVaaiUiComponentOverrides;
  /**
   * Typed `--sv-*` design-token overrides (brand color, radii, font, spacing).
   * The fastest way to restyle — applied to every `#studio-vaai-root` anchor
   * including the portaled sheet, so most theming needs no component overrides.
   */
  theme?: SvTokenOverrides;
  /**
   * Per-slot `className` overrides for the flow chrome — restyle without swapping
   * components. `shell` applies to every screen's sheet/modal shell (header, title,
   * body, footer, buttons …); `backdrop` styles the dimmed overlay behind the sheet.
   */
  classNames?: StudioVaaiDefaultFlowClassNames;
  /** Partial overrides for sheet/modal DOM landmark resolvers (scroll-aware preview sizing). */
  surfaceLandmarks?: PartialSurfaceLandmarks;
  /**
   * Observer for sheet open/close transitions. Fires whenever the sheet opens
   * (via `ref.open(...)`) or closes (close button, escape, backdrop, add-to-cart
   * auto-close). Not a "controlled" setter — open state is owned internally.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Fires when the sheet closes while the user is on the try-on result view,
   * carrying the variant of whichever carousel slide was visible.
   * Does not fire on add-to-cart (see {@link onAddToCart}) or when closing
   * from product overview or earlier flow steps.
   */
  onTryOnClose?: (input: StudioVaaiTryOnVariantInput) => void;
  /**
   * Fires when the user taps the add-to-cart CTA on the try-on view screen,
   * carrying the product + carousel-visible variant (its `variantId` and
   * `foreignVariantIds` in the shop's own ids) so the host can dispatch the actual commerce action. The flow always closes itself
   * after firing the callback.
   */
  onAddToCart?: (input: StudioVaaiTryOnVariantInput) => void;
  /**
   * Fires once for each try-on render that completes, carrying the image the result
   * screen displays. Use it to remember what a shopper has already tried on — merchandising
   * surfaces outside the flow (a collection grid, a "you in this" rail) can then show the
   * shopper's own render instead of a stock shot. Fires on cached replays of a variant only
   * the first time that image is seen, and never for failed try-ons.
   */
  onTryOnRendered?: (input: StudioVaaiTryOnRenderInput) => void;
}

/** Imperative handle returned via `ref` on {@link StudioVaaiDefaultFlow}. */
export interface StudioVaaiDefaultFlowHandle {
  /**
   * Open the sheet. Both fields tag the `entrypoint-clicked` analytics event:
   * - `entry`: the entrypoint placement (e.g. `"pdp-button"`, `"floating-cta"`);
   *   defaults to `"unknown"` when omitted.
   * - `subentry`: optional finer-grained classifier within `entry`
   *   (e.g. `"size-row"` under `entry: "pdp-button"`). Omitted from the event
   *   when not supplied.
   */
  open: (opts?: { entry?: string; subentry?: string }) => void;
  /** Close the sheet. Idempotent. */
  close: () => void;
}

interface StudioVaaiDefaultFlowInnerProps {
  onOpenChange: StudioVaaiDefaultFlowProps["onOpenChange"];
  onTryOnClose: StudioVaaiDefaultFlowProps["onTryOnClose"];
  onAddToCart: StudioVaaiDefaultFlowProps["onAddToCart"];
  onTryOnRendered: StudioVaaiDefaultFlowProps["onTryOnRendered"];
  backdropClassName?: string | undefined;
  handleRef: ForwardedRef<StudioVaaiDefaultFlowHandle>;
}

function StudioVaaiDefaultFlowInner({
  onOpenChange,
  onTryOnClose,
  onAddToCart,
  onTryOnRendered,
  backdropClassName,
  handleRef,
}: StudioVaaiDefaultFlowInnerProps) {
  const { state, dispatch, actor } = useStudioVaaiActor();
  const trackHostEvent = useStudioVaaiTracking();
  const ui = useStudioVaaiUi().messages;
  const vm = buildDefaultRootViewModel(state);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImageRef = useRef<NonNullable<PhotoUploadContext["image"]> | null>(null);
  const pendingRetrySourceRef = useRef<"photoUpload" | "bodyHeightCalibration" | "product" | null>(
    null,
  );
  // Queues an `OPEN_CAMERA` dispatch until `sessionIntro` reaches
  // `awaitingImage`. The camera CTA must trigger session creation first;
  // dispatching `OPEN_CAMERA` while session is `undefined` enters
  // `photoCapture` whose `invoke` reads `context.session!`.
  const pendingCameraOpenRef = useRef(false);
  const [cameraRetakeSource, setCameraRetakeSource] = useState<ImageFlowSource | null>(null);
  useEffect(() => {
    setCameraRetakeSource(null);
  }, [vm.phase]);
  /** Set when `INITIATE_IMAGE_UPLOAD` fires; cleared on file pick or picker cancel. */
  const imageUploadPendingRef = useRef(false);
  const imageUploadPendingSourceRef = useRef<ImageFlowSource>("intro");
  /** Host `intro-opened` (source: entry) fires at most once per flow mount. */
  const introOpenedFromEntryRef = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // True from the moment a file is selected until HEIC→JPEG conversion finishes (instant for
  // non-HEIC inputs). ORed into busy props so the spinner stays active even if conversion
  // outlasts the upload it runs in parallel with.
  const [isConverting, setIsConverting] = useState(false);
  const previewConversionRef = useRef<AbortController | null>(null);
  const stopPreviewConversion = useCallback(() => {
    previewConversionRef.current?.abort();
    previewConversionRef.current = null;
    setIsConverting(false);
  }, []);
  useEffect(() => {
    const subscription = actor.subscribe({ complete: stopPreviewConversion });
    return () => {
      subscription.unsubscribe();
      previewConversionRef.current?.abort();
      previewConversionRef.current = null;
    };
  }, [actor, stopPreviewConversion]);
  const { useAnotherImageSource, lastPhotoRejection } = state.context;

  // Consent checkbox state is lifted out of SessionIntroScreen so the central
  // error derivation can see it (the consent CTA is an always-enabled button —
  // its precondition has to be observable by `deriveError`).
  const [consented, setConsented] = useState(false);
  // The pending "click-disabled" reason, written by always-enabled CTAs via the
  // error context and consumed by `deriveError`. Stored as a tag, not a message.
  const [interactionReason, setInteractionReason] = useState<InteractionReason | undefined>();
  const clearInteractionReason = useCallback(() => {
    setInteractionReason(undefined);
  }, []);

  const sessionIntroChild =
    vm.phase === "sessionIntro" && state.matches({ sessionIntro: "creatingSession" })
      ? firstChildActor(actor)
      : undefined;
  const sessionIntroSnap = useSessionIntroChildSnapshot(sessionIntroChild);

  const previewSessionRef = useRef(state.context.session);
  useEffect(() => {
    const previous = previewSessionRef.current;
    previewSessionRef.current = state.context.session;
    if (
      (previous !== undefined && previous !== state.context.session) ||
      sessionIntroSnap?.value === "failed"
    ) {
      stopPreviewConversion();
    }
  }, [state.context.session, sessionIntroSnap?.value, stopPreviewConversion]);

  const photoChild = vm.phase === "photoUpload" ? firstChildActor(actor) : undefined;
  const photoSnap = usePhotoUploadChildSnapshot(photoChild);
  const photoSnapValue = photoSnap?.value;
  const photoRejectedErrorMessage =
    photoSnap === null ? undefined : photoUploadErrorMessage(photoSnap.context.lastError, ui);

  const photoRejectedScreenActive =
    vm.phase === "photoUpload" &&
    (photoSnapValue === "rejected" ||
      (useAnotherImageSource === "photoUpload" &&
        (photoSnapValue === "intro" ||
          photoSnapValue === "uploading" ||
          photoSnapValue === "uploadFailed")));

  const heightCalibrationScreenActive =
    vm.phase === "bodyHeightCalibration" ||
    (vm.phase === "photoUpload" &&
      useAnotherImageSource === "bodyHeightCalibration" &&
      photoSnapValue !== "rejected");

  const productScreenActive =
    vm.phase === "product" ||
    (vm.phase === "photoUpload" &&
      useAnotherImageSource === "product" &&
      photoSnapValue !== "rejected");

  let photoPreviewImage: PhotoUploadContext["image"] | undefined;
  if (photoSnapValue === "rejected") {
    photoPreviewImage = photoSnap?.context.image ?? lastPhotoRejection?.image;
  } else if (
    useAnotherImageSource === "photoUpload" &&
    (photoSnapValue === "intro" ||
      photoSnapValue === "uploading" ||
      photoSnapValue === "uploadFailed")
  ) {
    // Prefer the freshly-selected image so the preview updates as soon as the
    // new upload kicks off; fall back to the prior rejection only for the brief
    // pre-flush window (child still in `intro`, `image` not yet attached) to
    // avoid a blank flash.
    photoPreviewImage = photoSnap?.context.image ?? lastPhotoRejection?.image;
  }

  const photoPreviewUrl = usePhotoPreviewUrl(photoPreviewImage, photoRejectedScreenActive);

  // Camera-path upload-in-flight: render the captured still inside the
  // photo-capture screen so the user stays on the camera view across the
  // photoCapture → photoUpload transition.
  const cameraUploadingActive =
    vm.phase === "photoUpload" &&
    state.context.photoSource === "camera" &&
    (photoSnapValue === "intro" || photoSnapValue === "uploading");
  const cameraUploadingPreviewUrl = usePhotoPreviewUrl(
    state.context.pendingSelectedImage,
    cameraUploadingActive,
  );

  // While "use another image" re-uploads from the calibration/product screens,
  // `lastCapturedImage` still points at the previously-accepted photo (it's only
  // replaced once the new upload reaches `accepted`). Prefer the in-flight image
  // so the preview swaps to the new photo the moment the upload kicks off; fall
  // back to `lastCapturedImage` for the brief pre-flush `intro` window.
  const inFlightReplacementImage =
    vm.phase === "photoUpload" && photoSnapValue !== "rejected"
      ? photoSnap?.context.image
      : undefined;

  // ONE object URL for the accepted photo, shared by the height screen, the size-selection
  // hero and the try-on's busy source-photo slide. These used to be two hooks (height /
  // product), which minted a fresh URL — and re-decoded the image — on every height→product
  // transition; a single hook keeps the URL stable for as long as either screen is active,
  // so the photo can never flash or go blank across the step change. The retry sources are
  // mutually exclusive with each other, so preferring the in-flight replacement whenever one
  // of the two retry flows owns it preserves the per-screen behaviour exactly.
  const capturedPhotoUrl = usePhotoPreviewUrl(
    (useAnotherImageSource === "bodyHeightCalibration" || useAnotherImageSource === "product"
      ? inFlightReplacementImage
      : undefined) ?? state.context.lastCapturedImage,
    heightCalibrationScreenActive || productScreenActive,
  );

  const heightCalibrationChild =
    vm.phase === "bodyHeightCalibration" ? firstChildActor(actor) : undefined;
  const heightCalibrationSnap = useBodyHeightCalibrationChildSnapshot(heightCalibrationChild);
  const heightCtx: BodyHeightCalibrationContext | undefined =
    vm.phase === "bodyHeightCalibration" && heightCalibrationSnap !== null
      ? heightCalibrationSnap.context
      : undefined;

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }
    const handleChange = (): void => {
      setPickerOpen(false);
      imageUploadPendingRef.current = false;
      const f = input.files?.[0];
      input.value = "";
      if (!f) {
        return;
      }
      // Dispatch the image immediately so create-session / create-body API calls kick off in
      // parallel with the HEIC→JPEG conversion below. The original `file` flows through the
      // upload path; `previewBlob` is attached later via `ATTACH_PREVIEW_BLOB` once conversion
      // finishes (no-op for non-HEIC inputs).
      const image: NonNullable<PhotoUploadContext["image"]> = { type: "file", file: f };
      const pendingRetrySource = pendingRetrySourceRef.current;
      if (pendingRetrySource !== null) {
        pendingRetrySourceRef.current = null;
        dispatch({ type: "USE_ANOTHER_IMAGE", source: pendingRetrySource });
        pendingImageRef.current = image;
      } else if (vm.phase === "sessionIntro") {
        if (state.matches({ sessionIntro: "awaitingImage" })) {
          dispatch({ type: "IMAGE_SELECTED", image });
        } else if (state.matches({ sessionIntro: "creatingSession" })) {
          // Parent is still creatingSession even when the child machine is in
          // `failed` (the parent transitions only on the child's `ready`
          // final). Always queue here; the flush effect immediately discards
          // when sessionIntroSnap.value === "failed".
          pendingImageRef.current = image;
        }
      } else if (vm.phase === "photoUpload") {
        const child = firstChildActor(actor);
        const snap = child === undefined ? undefined : (child.getSnapshot() as PhotoUploadSnapshot);
        if (
          (snap?.value === "intro" ||
            snap?.value === "uploadFailed" ||
            snap?.value === "rejected") &&
          child !== undefined
        ) {
          child.send({ type: "IMAGE_SELECTED", image });
        } else {
          pendingImageRef.current = image;
        }
      } else {
        if (vm.phase === "photoCapture") {
          // Library pick from the camera screen's fallback CTA: leave the camera (the mount
          // unmounts and stops the stream) — the queued image below is flushed once
          // `CANCEL_CAMERA` lands the machine on `sessionIntro.awaitingImage`.
          dispatch({ type: "CANCEL_CAMERA" });
        }
        pendingImageRef.current = image;
      }

      // Run conversion concurrently. The `isConverting` flag keeps the busy spinner active even
      // if the conversion outlasts the in-flight upload (rare, but possible for very large HEICs
      // on slow devices).
      stopPreviewConversion();
      const conversion = new AbortController();
      previewConversionRef.current = conversion;
      setIsConverting(true);
      void (async () => {
        try {
          const previewBlob = await convertHeicToJpeg(f, f.name, conversion.signal);
          if (previewBlob === undefined || conversion.signal.aborted) {
            return;
          }
          // If the dispatch was queued (e.g. picked during creatingSession), fold the previewBlob
          // into the queued image so the eventual flush sends a complete picture in one event.
          const queued = pendingImageRef.current;
          if (queued?.type === "file" && queued.file === f) {
            pendingImageRef.current = { ...queued, previewBlob };
          }
          // Update whichever machine currently holds the image. defaultRoot's handler updates
          // `pendingSelectedImage` / `lastCapturedImage`; photoUploadMachine's handler updates
          // its own `image`. Each handler verifies via `previewFor` that it's pointing at the
          // same source (drops the event if the user has since picked another file).
          dispatch({ type: "ATTACH_PREVIEW_BLOB", previewFor: f, previewBlob });
          firstChildActor(actor)?.send({
            type: "ATTACH_PREVIEW_BLOB",
            previewFor: f,
            previewBlob,
          });
        } catch {
          // Preview work is optional; upload validation remains authoritative.
        } finally {
          if (previewConversionRef.current === conversion) {
            previewConversionRef.current = null;
            setIsConverting(false);
          }
        }
      })();
    };
    const handleCancel = (): void => {
      setPickerOpen(false);
      input.value = "";
      pendingRetrySourceRef.current = null;
      if (imageUploadPendingRef.current) {
        imageUploadPendingRef.current = false;
        dispatch({
          type: "CANCEL_UPLOAD",
          source: imageUploadPendingSourceRef.current,
        });
      }
    };
    input.addEventListener("change", handleChange);
    input.addEventListener("cancel", handleCancel);
    return () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
    };
  }, [actor, dispatch, state, vm.phase, stopPreviewConversion]);

  useEffect(() => {
    const pending = pendingImageRef.current;
    if (!pending) {
      return;
    }
    if (state.matches({ sessionIntro: "awaitingImage" })) {
      dispatch({ type: "IMAGE_SELECTED", image: pending });
      pendingImageRef.current = null;
      return;
    }
    if (sessionIntroSnap?.value === "failed") {
      // Session creation failed while a file was queued mid-flight; drop it
      // so a successful retry doesn't silently upload a stale pick.
      pendingImageRef.current = null;
      return;
    }
    if (
      state.matches("photoUpload") &&
      (photoSnap?.value === "intro" ||
        photoSnap?.value === "uploadFailed" ||
        photoSnap?.value === "rejected")
    ) {
      const child = firstChildActor(actor);
      child?.send({ type: "IMAGE_SELECTED", image: pending });
      pendingImageRef.current = null;
      return;
    }
    if (vm.phase === "product" || vm.phase === "bodyHeightCalibration") {
      pendingImageRef.current = null;
    }
  }, [actor, dispatch, photoSnap?.value, sessionIntroSnap?.value, state, vm.phase]);

  useEffect(() => {
    if (!pendingCameraOpenRef.current) {
      return;
    }
    if (state.matches({ sessionIntro: "awaitingImage" })) {
      pendingCameraOpenRef.current = false;
      dispatch({ type: "OPEN_CAMERA", source: "intro" });
      return;
    }
    if (sessionIntroSnap?.value === "failed" || !state.matches("sessionIntro")) {
      pendingCameraOpenRef.current = false;
    }
  }, [dispatch, sessionIntroSnap?.value, state]);

  const { selection } = state.context;

  // (a) Drop any pending click-disabled error when the user leaves the screen.
  useEffect(() => {
    clearInteractionReason();
  }, [vm.phase, clearInteractionReason]);
  // (b)/(c) Drop it the moment its precondition resolves (size picked, consent
  // ticked, …). The display already hides a resolved reason via `deriveError`;
  // this clears the stored tag so a later re-toggle can't resurrect it. Same
  // predicate that drives the button's `disabled` state — no separate wiring.
  useEffect(() => {
    if (
      interactionReason !== undefined &&
      isReasonResolved(interactionReason, {
        reason: interactionReason,
        consented,
        vm,
        product: state.context.product,
        selection,
        ui,
        machineError: undefined,
      })
    ) {
      clearInteractionReason();
    }
  }, [
    interactionReason,
    consented,
    vm,
    selection,
    state.context.product,
    ui,
    clearInteractionReason,
  ]);

  const openPicker = (): void => {
    setPickerOpen(true);
    openPhotoLibrary(fileInputRef.current);
  };

  const initiateGalleryUpload = (
    source: ImageFlowSource,
    retrySource?: "photoUpload" | "bodyHeightCalibration" | "product",
  ): void => {
    pendingRetrySourceRef.current = retrySource ?? null;
    dispatch({ type: "INITIATE_IMAGE_UPLOAD", source });
    imageUploadPendingSourceRef.current = source;
    imageUploadPendingRef.current = true;
    openPicker();
  };

  const openCamera = (source: ImageFlowSource): void => {
    pendingRetrySourceRef.current = null;
    dispatch({ type: "OPEN_CAMERA", source });
  };

  const requestCameraRetake = (source: ImageFlowSource): void => {
    // Keep the photo, calibration, and try-on history until the shopper confirms.
    setCameraRetakeSource(source);
  };

  const onConsent = (): void => {
    firstChildActor(actor)?.send({ type: "CONSENT_GRANTED" });
    initiateGalleryUpload("intro");
  };

  const onTakePhoto = (): void => {
    if (state.matches({ sessionIntro: "awaitingImage" })) {
      // Session already exists (returning user, or primary CTA path that
      // landed on `awaitingImage` first) — open the camera directly.
      openCamera("intro");
      return;
    }
    firstChildActor(actor)?.send({ type: "CONSENT_GRANTED" });
    pendingCameraOpenRef.current = true;
  };

  const onHeightChange = useCallback(
    (heightCm: number): void => {
      firstChildActor(actor)?.send({ type: "SET_HEIGHT", heightCm });
    },
    [actor],
  );

  const onConfirmHeight = (): void => {
    firstChildActor(actor)?.send({ type: "CONFIRM" });
  };

  const onPhotoRetry = (): void => {
    // A rejected photo cannot be used for a try-on, so retake it directly
    // without asking for confirmation. Keep the original source preference.
    if (state.context.photoSource === "camera") {
      openCamera("image-rejection");
      return;
    }
    initiateGalleryUpload("image-rejection", useAnotherImageSource ?? "photoUpload");
  };

  const onUseAnotherImageFromHeight = (): void => {
    // If the current photo came from the in-browser camera, retake with the
    // camera too instead of opening the system file picker.
    if (state.context.photoSource === "camera") {
      requestCameraRetake("height");
      return;
    }
    initiateGalleryUpload("height", "bodyHeightCalibration");
  };

  const onUseAnotherImageFromProduct = (): void => {
    // Mirror the height-screen behavior: camera-sourced photos retake via the
    // camera flow rather than opening the system file picker.
    if (state.context.photoSource === "camera") {
      requestCameraRetake("variant-selection");
      return;
    }
    initiateGalleryUpload("variant-selection", "product");
  };

  const onGuideToGreatPhoto = (): void => {
    dispatch({ type: "RETURN_TO_SESSION_INTRO_FOR_GUIDE" });
  };

  const onTryOnResultBack = (): void => {
    dispatch({ type: "RETURN_TO_VARIANT_SELECTION", via: "back" });
  };

  // Picking a size in the try-on view that has no render yet: switch the selection and re-run the
  // try-on in place. Both are root events processed synchronously (`dispatch` is `actor.send`):
  // `SELECT_VARIANT` updates the selection, then `START_TRY_ON` — which the `resulting` state now
  // handles — routes the pipeline `resulting → requesting` with the freshly-selected size. No
  // dependency on the result child's internal state, so it's reliable on the first result too.
  const onTryOnSelectVariant = (attributes: VariantAttributes): void => {
    dispatch({ type: "SELECT_VARIANT", selection: attributes });
    dispatch({ type: "START_TRY_ON" });
  };

  const [internalOpen, setInternalOpen] = useState(false);
  // SSR-safe hydration flag. `useSyncExternalStore` returns the server snapshot
  // (`false`) on the server and during initial hydration, then transitions to the
  // client snapshot (`true`) — React applies that diff as a non-blocking update,
  // unlike a `useState + useEffect` flip which can fire mid-Suspense-hydration and
  // trigger "boundary received an update before it finished hydrating."
  const hydrated = useSyncExternalStore(subscribeNoop, getClientTrue, getServerFalse);
  const sheetOpen: boolean = hydrated && internalOpen;
  const stateRef = useRef(state);
  stateRef.current = state;
  const shownAttributesRef = useRef<VariantAttributes | null>(null);
  const tryOnViewActive = isTryOnViewActive(state);
  useEffect(() => {
    if (!tryOnViewActive) {
      shownAttributesRef.current = null;
    }
  }, [tryOnViewActive]);
  const onTryOnShownAttributesChange = useCallback((attributes: VariantAttributes): void => {
    shownAttributesRef.current = attributes;
  }, []);
  const setSheetOpen = useCallback(
    (next: boolean, opts?: { skipTryOnClose?: boolean }): void => {
      if (!next) {
        stopPreviewConversion();
      }
      // Mark as a transition so updates arriving from outside React's commit cycle
      // (close button during a still-suspending parent route) don't preempt
      // in-flight hydration.
      startTransition(() => {
        if (!next && opts?.skipTryOnClose !== true && isTryOnViewActive(stateRef.current)) {
          const attributes = shownAttributesRef.current;
          if (attributes !== null) {
            onTryOnClose?.(tryOnVariantInput(stateRef.current.context.product, attributes));
          }
        }
        if (!next) {
          setCameraRetakeSource(null);
        }
        setInternalOpen(next);
        onOpenChange?.(next);
      });
    },
    [onOpenChange, onTryOnClose, stopPreviewConversion],
  );
  const onSheetOpenChange = useCallback(
    (next: boolean): void => {
      setSheetOpen(next);
    },
    [setSheetOpen],
  );

  useImperativeHandle(
    handleRef,
    (): StudioVaaiDefaultFlowHandle => ({
      open: (opts) => {
        const entry = opts?.entry ?? "unknown";
        const snap = stateRef.current;
        trackHostEvent({
          type: "entrypoint-clicked",
          "product-id": String(snap.context.product.id),
          entry,
          ...(opts?.subentry === undefined ? {} : { subentry: opts.subentry }),
        });
        if (stepFromSnapshot(snap) === "intro" && !introOpenedFromEntryRef.current) {
          introOpenedFromEntryRef.current = true;
          trackHostEvent({
            type: "intro-opened",
            "product-id": String(snap.context.product.id),
            source: "entry",
          });
        }
        setSheetOpen(true);
      },
      close: () => {
        setSheetOpen(false);
      },
    }),
    [setSheetOpen, trackHostEvent],
  );

  const closeSheet = (opts?: { skipTryOnClose?: boolean }): void => {
    // Drop any queued camera open so reopening doesn't auto-jump into
    // `photoCapture` after session creation resolves in the background.
    pendingCameraOpenRef.current = false;
    trackHostEvent({
      type: "view-closed",
      "product-id": String(stateRef.current.context.product.id),
    });
    setSheetOpen(false, opts);
  };

  const handleAddToCart = (attributes: VariantAttributes): void => {
    trackHostEvent({
      type: "cart-item-added",
      "product-id": String(stateRef.current.context.product.id),
      variants: { ...attributes },
    });
    onAddToCart?.(tryOnVariantInput(stateRef.current.context.product, attributes));
    closeSheet({ skipTryOnClose: true });
  };

  // Report completed renders to the host as they land. Driven off the history entries rather
  // than the pipeline's success transition so a cached replay still reports (the entry is what
  // the result screen actually shows), and deduped on product+URL so swiping the carousel back
  // and forth over the same slides does not re-fire. `onTryOnRendered` is read through a ref so
  // an inline arrow from the host cannot restart the effect on every render.
  const onTryOnRenderedRef = useRef(onTryOnRendered);
  onTryOnRenderedRef.current = onTryOnRendered;
  const reportedRendersRef = useRef<Set<string>>(new Set());
  const { product: flowProduct } = state.context;
  const completedRenders = selectProductTryOnHistory(state.context, flowProduct.id).entries.filter(
    (e) => e.status === "completed",
  );
  const completedRenderKey = completedRenders.map((e) => e.imageUrl).join("\0");
  useEffect(() => {
    for (const entry of completedRenders) {
      const key = `${String(flowProduct.id)}\0${entry.imageUrl}`;
      if (reportedRendersRef.current.has(key)) {
        continue;
      }
      reportedRendersRef.current.add(key);
      onTryOnRenderedRef.current?.({
        ...tryOnVariantInput(flowProduct, entry.attributes),
        imageUrl: entry.imageUrl,
        tryOnId: String(entry.tryOnId ?? ""),
      });
    }
    // `completedRenderKey` stands in for the entry list: a stable string that changes exactly
    // when a new render lands, so the effect does not re-run on every unrelated state tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedRenderKey, flowProduct]);

  const onPhotoRejectBack = (): void => {
    dispatch({ type: "CANCEL_USE_ANOTHER_IMAGE" });
  };

  const onHeightCalibrationBack = (): void => {
    if (useAnotherImageSource === "bodyHeightCalibration") {
      dispatch({ type: "CANCEL_USE_ANOTHER_IMAGE" });
      return;
    }
    // Camera path: returning from height takes the user back to the camera
    // screen rather than the session-intro/guide flow.
    if (state.context.photoSource === "camera") {
      requestCameraRetake("height");
      return;
    }
    dispatch({ type: "RETURN_TO_SESSION_INTRO_FOR_GUIDE" });
  };

  const lastRejectionErrorMessage = photoUploadErrorMessage(lastPhotoRejection?.error, ui);
  let photoRejectedErrorForDisplay: ReactNode =
    photoRejectedErrorMessage ?? lastRejectionErrorMessage;
  if (photoSnapValue === "uploading") {
    photoRejectedErrorForDisplay = undefined;
  } else if (photoSnapValue === "uploadFailed") {
    photoRejectedErrorForDisplay = ui.sessionIntro.uploadError;
  }

  const retryingFromHeightOrProduct =
    vm.phase === "photoUpload" &&
    (useAnotherImageSource === "bodyHeightCalibration" || useAnotherImageSource === "product");
  const retryUploadBusy =
    retryingFromHeightOrProduct && (photoSnapValue === "uploading" || isConverting);
  const retryUploadFailedError: ReactNode | undefined =
    retryingFromHeightOrProduct && photoSnapValue === "uploadFailed"
      ? (photoUploadErrorMessage(photoSnap?.context.lastError, ui) ?? ui.sessionIntro.uploadError)
      : undefined;

  // The machine-/state-derived error for whichever screen is active. Fed to
  // `deriveError`, which shows it only when no click-disabled interaction error
  // is pending. (photoCapture owns its own status body, so it stays undefined.)
  let machineError: ReactNode | undefined;
  let sheetContent: ReactNode = null;
  if (vm.phase === "photoCapture") {
    // Camera flow: render the mount when the child actor is available. It
    // owns the MediaStream lifecycle and dispatches into the camera child.
    const cameraChild = firstChildActor(actor);
    sheetContent =
      cameraChild === undefined ? null : (
        <PhotoCaptureMount
          camera={cameraChild}
          onCancelCamera={() => {
            dispatch({ type: "CANCEL_CAMERA" });
          }}
          onUploadFromLibrary={() => {
            // Open the system picker while the camera stays live behind it — dismissing the
            // picker keeps the user on the camera. The actual hand-off happens in the file
            // input's change handler (CANCEL_CAMERA + queued image).
            initiateGalleryUpload(state.context.imageFlowSource ?? "intro");
          }}
          onClose={closeSheet}
        />
      );
  } else if (cameraUploadingActive) {
    // Camera path mid-upload: stay on the camera screen, show the captured
    // still + a busy overlay. The camera child has unmounted by now (root has
    // moved to photoUpload), so render the presentational screen directly.
    const cameraFrameLock = state.context.pendingSelectedImage?.frameLock;
    sheetContent = (
      <PhotoCaptureScreen
        status="uploading"
        previewSrc={cameraUploadingPreviewUrl ?? ""}
        {...(cameraFrameLock === undefined ? {} : { capturedFrameLock: cameraFrameLock })}
        busy
        onStartSelfTimer={() => {
          /* unreachable in `uploading`; no CTAs rendered */
        }}
        onBack={() => {
          /* back navigation during camera upload is intentionally blocked */
        }}
        onClose={closeSheet}
      />
    );
  } else if (photoRejectedScreenActive) {
    const rejectedFrameLock = photoPreviewImage?.frameLock;
    machineError = photoRejectedErrorForDisplay ?? ui.photoUpload.fallbackError;
    sheetContent = (
      <PhotoUploadRejectedScreen
        previewSrc={photoPreviewUrl ?? ""}
        {...(rejectedFrameLock === undefined ? {} : { frameLock: rejectedFrameLock })}
        busy={photoSnapValue === "uploading" || isConverting}
        onRetry={onPhotoRetry}
        onGuideToGreatPhoto={onGuideToGreatPhoto}
        onBack={onPhotoRejectBack}
        onClose={closeSheet}
      />
    );
  } else if (heightCalibrationScreenActive) {
    const heightCmForScreen =
      heightCtx?.heightCm ?? state.context.bodyHeightCm ?? state.context.bodyPredictedHeightCm ?? 0;
    const heightFrameLock = state.context.lastCapturedImage?.frameLock;
    // Calibration failure is read from root context (it survives the child's
    // `failed -> editing` reset when the picker re-syncs), not the child's
    // transient state.
    const calibrationFailed =
      !retryingFromHeightOrProduct && state.context.lastCalibrationError !== undefined;
    machineError =
      retryUploadFailedError ??
      (calibrationFailed ? ui.heightCalibration.fallbackError : undefined);
    sheetContent = (
      <HeightCalibrationScreen
        previewSrc={capturedPhotoUrl ?? ""}
        {...(heightFrameLock === undefined ? {} : { frameLock: heightFrameLock })}
        heightCm={heightCmForScreen}
        onHeightChange={onHeightChange}
        onConfirm={onConfirmHeight}
        onUseAnotherImage={onUseAnotherImageFromHeight}
        onBack={onHeightCalibrationBack}
        onClose={closeSheet}
        busy={retryUploadBusy || heightCalibrationSnap?.value === "calibrating"}
      />
    );
  } else if (productScreenActive) {
    const { product } = state.context;
    const history = selectProductTryOnHistory(state.context, product.id);
    const visibleTryOnUrl = history.currentEntry?.imageUrl ?? undefined;
    const tryOnInFlight = isTryOnViewActive(state);
    if (tryOnInFlight) {
      const historySlides = tryOnHistorySlides(history, state.context.bodyRevisions, ui.locale);
      let carouselSlides: TryOnViewCarouselSlide[];
      let initialSlideIndex: number;
      if (vm.tryOnPipeline === "requesting") {
        // Busy state always sits on top of the source photo (rendered as the last
        // carousel slide) — swiping back reveals untouched history entries. The in-flight
        // try-on is for the live `selection`, so the source-photo slide carries those
        // attributes (drives the size/colorway line under the carousel while busy).
        const sourcePhoto = capturedPhotoUrl ?? "";
        carouselSlides =
          sourcePhoto.length > 0
            ? [...historySlides, { src: sourcePhoto, attributes: selection }]
            : historySlides;
        initialSlideIndex = Math.max(0, carouselSlides.length - 1);
      } else {
        carouselSlides = historySlides;
        // `history.cursor` indexes the FULL entries list, but `historySlides` contains only
        // COMPLETED entries (failed / blocked sizes are filtered out — see `tryOnHistorySlides`).
        // Using the raw cursor as a carousel index therefore lands on the WRONG slide as soon as a
        // non-completed entry sits before the cursor (e.g. a "too small" size the shopper tried).
        // Map the cursor to its position AMONG the completed entries so the carousel — and the hero
        // that follows it — land on the size the shopper actually picked.
        const completedUpToCursor = history.entries
          .slice(0, history.cursor + 1)
          .filter((e) => e.status === "completed").length;
        initialSlideIndex = Math.max(0, completedUpToCursor - 1);
      }
      // `pendingTryOn` is set on success and held through the next requesting
      // phase (see try-on-pipeline-region) — so once we've gotten a scene back,
      // the color stays applied through subsequent try-ons of the same product
      // without flicker. Falls back to undefined (default token wins) on the
      // very first `requesting` before any try-on has resolved.
      const pendingScene = state.context.pendingTryOn?.result;
      const slideOverlayColor =
        pendingScene?.status === "success" ? pendingScene.scene.overlayColor : undefined;
      sheetContent = (
        <TryOnViewScreen
          product={product}
          selection={selection}
          vm={vm}
          {...(state.context.lastTryOnFailure === undefined
            ? {}
            : { lastTryOnFailure: state.context.lastTryOnFailure })}
          carouselSlides={carouselSlides}
          initialSlideIndex={initialSlideIndex}
          onBack={onTryOnResultBack}
          onClose={closeSheet}
          onAddToCart={handleAddToCart}
          onShownAttributesChange={onTryOnShownAttributesChange}
          onSelectVariant={onTryOnSelectVariant}
          onRetryRecommendation={() => {
            dispatch({ type: "RECOMMENDATION_REQUEST" });
          }}
          {...(product.priceLabel === undefined ? {} : { priceLabel: product.priceLabel })}
          {...(slideOverlayColor === undefined ? {} : { slideOverlayColor })}
        />
      );
    } else {
      // Hero only carries the capture's frameLock when we're falling back to
      // the original photo — server-returned try-on results arrive cropped.
      const heroFrameLock =
        visibleTryOnUrl === undefined ? state.context.lastCapturedImage?.frameLock : undefined;
      // Collapse the product screen's error sources into one (retry-upload >
      // try-on failure > recommendation failure). Only one shows at a time.
      machineError =
        retryUploadFailedError ??
        (vm.tryOnPipeline === "error" ? ui.productOverview.tryOnError : undefined) ??
        (vm.recommendation === "error" ? ui.productOverview.recommendationError : undefined);
      sheetContent = (
        <ProductOverviewScreen
          product={product}
          selection={selection}
          vm={vm}
          {...(state.context.lastTryOnFailure === undefined
            ? {}
            : { lastTryOnFailure: state.context.lastTryOnFailure })}
          busy={retryUploadBusy}
          heroImageSrc={visibleTryOnUrl ?? capturedPhotoUrl ?? ""}
          {...(heroFrameLock === undefined ? {} : { heroFrameLock })}
          onSelectVariant={(sel) => {
            dispatch({ type: "SELECT_VARIANT", selection: sel });
          }}
          onRecommendationRequest={() => {
            dispatch({ type: "RECOMMENDATION_REQUEST" });
          }}
          onStartTryOn={() => {
            dispatch({ type: "START_TRY_ON" });
          }}
          onSelectionRequired={() => {
            setInteractionReason("selectionRequired");
          }}
          onClose={closeSheet}
          onBackToHeight={() => {
            dispatch({ type: "BACK_TO_HEIGHT" });
          }}
          onUseAnotherImage={onUseAnotherImageFromProduct}
        />
      );
    }
  } else if (vm.phase === "sessionIntro" || vm.phase === "photoUpload") {
    const sessionIntroErrorKind = pickerOpen
      ? undefined
      : resolveSessionIntroErrorKind(sessionIntroSnap, photoSnap);
    if (sessionIntroErrorKind === "upload") {
      machineError = ui.sessionIntro.uploadError;
    } else if (sessionIntroErrorKind === "createSession") {
      machineError = ui.sessionIntro.createSessionError;
    }
    sheetContent = (
      <SessionIntroScreen
        onConsent={onConsent}
        onTakePhoto={onTakePhoto}
        hideConsent={
          state.matches({ sessionIntro: "restoringSession" }) ||
          state.context.consentGivenOrRestored
        }
        busy={
          state.matches({ sessionIntro: "restoringSession" }) ||
          (vm.phase === "photoUpload" && photoSnapValue === "uploading") ||
          isConverting
        }
        consented={consented}
        onConsentChange={setConsented}
        onConsentRequired={() => {
          setInteractionReason("consentRequired");
        }}
        // Nothing precedes the intro in the machine, so back dismisses — same outcome as the
        // close control, which is what the design intends here (see `SessionIntroScreen.onBack`).
        onBack={closeSheet}
        onClose={closeSheet}
      />
    );
  }

  // Single source of truth for the visible error: the click-disabled interaction
  // error (gated by its precondition) wins over the active screen's machine error.
  const errorContextValue: ErrorContextValue = {
    error: deriveError({
      reason: interactionReason,
      consented,
      vm,
      product: state.context.product,
      selection,
      ui,
      machineError,
    }),
    setReason: setInteractionReason,
    clearReason: clearInteractionReason,
  };

  // Emit no inline block content: callers may mount <StudioVaaiDefaultFlow/>
  // inside phrasing-content parents (e.g. <p>). The hidden <input> below is
  // phrasing; the sheet UI lives in DefaultFlowSheetMount's portal.
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="sv:sr-only"
        aria-hidden
        tabIndex={-1}
        // Inline `display: none` (not just `sv:sr-only`) to avoid a flicker until CSS loads.
        style={{ display: "none" }}
      />
      {/*
        ErrorProvider wraps the *mount*, not `sheetContent` inside it, so it sits
        at the same level as the flow's other contexts (UI/theme/i18n/responsive)
        — all above DefaultFlowSheetMount. A `DefaultFlowSheetMount` override that
        re-plumbs `children` through its own drawer/portal can drop a provider
        nested inside `children`; one above the override is an ancestor of
        whatever the override renders (any context-preserving portal), so the
        screens' <ErrorMessage> always finds it.
      */}
      <ErrorProvider value={errorContextValue}>
        <DefaultFlowSheetMount
          open={sheetOpen}
          onOpenChange={onSheetOpenChange}
          {...(backdropClassName === undefined ? {} : { backdropClassName })}
        >
          {sheetContent}
          <PhotoRetakeDialog
            open={sheetOpen && cameraRetakeSource !== null}
            onCancel={() => {
              setCameraRetakeSource(null);
            }}
            onContinue={() => {
              if (cameraRetakeSource !== null) {
                openCamera(cameraRetakeSource);
                setCameraRetakeSource(null);
              }
            }}
          />
        </DefaultFlowSheetMount>
      </ErrorProvider>
    </>
  );
}

export const StudioVaaiDefaultFlow = forwardRef<
  StudioVaaiDefaultFlowHandle,
  StudioVaaiDefaultFlowProps
>(function StudioVaaiDefaultFlow(
  {
    locale,
    messages,
    components,
    theme,
    classNames,
    surfaceLandmarks,
    onOpenChange,
    onTryOnClose,
    onAddToCart,
    onTryOnRendered,
  },
  ref,
): ReactElement {
  return (
    <StudioVaaiUiProvider
      locale={locale ?? "en"}
      {...(messages === undefined ? {} : { messages })}
      {...(components === undefined ? {} : { components })}
      {...(theme === undefined ? {} : { theme })}
      {...(classNames?.shell === undefined ? {} : { shellClassNames: classNames.shell })}
      {...(surfaceLandmarks === undefined ? {} : { surfaceLandmarks })}
    >
      <StudioVaaiDefaultFlowInner
        handleRef={ref}
        onOpenChange={onOpenChange}
        onTryOnClose={onTryOnClose}
        onAddToCart={onAddToCart}
        onTryOnRendered={onTryOnRendered}
        {...(classNames?.backdrop === undefined ? {} : { backdropClassName: classNames.backdrop })}
      />
    </StudioVaaiUiProvider>
  );
});
