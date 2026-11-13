"use client";

import type { FrameLock } from "@studio-vaai/js-machine";
import type { RefObject, ReactNode } from "react";

import { useEffect, useRef } from "react";

import { useStudioVaaiUi } from "../studio-vaai-ui-provider.js";
import { Text } from "../typography/text.js";
import { ActionsSection } from "../ui/actions-section.js";
import { Button, flowPrimaryCtaClassName, flowSecondaryCtaClassName } from "../ui/button.js";
import { cn } from "../ui/cn.js";
import { IconAlertCircle, IconCamera, IconInfo, IconSwitchCamera } from "../ui/icons.js";
import { ResponsiveSplit } from "../ui/responsive-split.js";
import { SheetShell } from "../ui/sheet.js";
import { Spinner } from "../ui/spinner.js";
import {
  NaturalAspectPreviewFrame,
  useNaturalAspectPreviewFrame,
} from "./natural-aspect-preview-frame.js";
import { useCanvasMediaPreview } from "./use-canvas-media-preview.js";
import { usePreviewBaselineAspect } from "./use-preview-baseline-aspect.js";

/**
 * Operational status driven by the host (which owns the {@link MediaStream}).
 *
 * - `idle`: pre-permission. Show an "Allow camera" CTA; clicking it triggers the
 *   host's `getUserMedia` call (browsers require a user gesture).
 * - `live`: stream available; render the preview and capture controls.
 * - `uploading`: post-capture, upload in flight. Render the captured still
 *   (`previewSrc`) inside the same preview frame so the user perceives the
 *   screen as unchanged across the camera-to-upload transition. No CTAs;
 *   header chrome locked via `busy`.
 * - `denied`: `NotAllowedError` / `PermissionDeniedError`. Body explains how to
 *   re-enable camera access in browser settings.
 * - `unavailable`: `NotFoundError` (no camera hardware) or policy blocks (`OverconstrainedError`).
 * - `error`: other failures (`NotReadableError`, transient hardware issues, etc.).
 */
export type PhotoCaptureScreenStatus =
  | "idle"
  | "live"
  | "uploading"
  | "denied"
  | "unavailable"
  | "error";

interface PhotoCaptureScreenProps {
  status: PhotoCaptureScreenStatus;
  /** Live camera stream when `status === "live"`. Attached to the preview `<video>` element. */
  stream?: MediaStream | null;
  /**
   * Object URL for the captured still, shown when `status === "uploading"`. Hosts
   * typically derive this from the captured Blob via `URL.createObjectURL` and
   * revoke it once the screen unmounts.
   */
  previewSrc?: string;
  /**
   * Mirror the live preview horizontally — natural for selfie / user-facing cameras
   * so the user sees themselves as they would in a mirror. Defaults to `true`.
   */
  mirrored?: boolean;
  /**
   * When set (non-null integer), an overlay countdown is rendered over the live
   * preview and the secondary CTA flips to a "Cancel timer" button. The host owns
   * the actual timer and decrements this value each second.
   */
  countdownSeconds?: number | null;
  /**
   * Self-timer duration shown inside the `selfTimerCta` label, in seconds.
   * Surfaced as a prop (not hardcoded) so the host machine drives the value.
   */
  selfTimerDurationSeconds?: number;
  /**
   * Optional external ref to the underlying `<video>` element. Hosts pass one in
   * to grab a frame for encoding (typical wiring path); when omitted the screen
   * falls back to an internal ref and the live preview still renders.
   */
  videoRef?: RefObject<HTMLVideoElement | null>;
  /**
   * Aspect ratio of the live preview's composition frame, as `width / height`.
   * Drives the bbox the user composes within during `idle` / `live` / errors
   * (the frame is fixed-shape across those states so layout doesn't reflow).
   * For `uploading` the captured still is rendered at the natural aspect of
   * `capturedFrameLock` (which the host computes at shutter time from this
   * value) — there's no fixed aspect on captured imagery.
   *
   * Default depends on the {@link useStudioVaaiUi} `responsive.layout`:
   * - `bottomSheet`: `3 / 4` — portrait baseline (H:W ≥ 4:3); the sheet is tall,
   *   so the photo viewport is portrait-shaped.
   * - `modal`: `4 / 3` — landscape baseline (W:H ≥ 4:3); the modal is wide.
   */
  previewAspectRatio?: number;
  /**
   * Fired whenever the live preview frame's aspect changes (mount,
   * responsive-layout flip, override). Hosts cache this value and stamp it
   * onto the captured Blob's {@link FrameLock} at shutter time so downstream
   * displays can re-create the same crop.
   */
  onFrameLockChange?: (previewAspectRatio: number) => void;
  /**
   * Sub-rect of `previewSrc` to display during `uploading`. The host computes
   * it at shutter time from the cached preview aspect and the encoded Blob's
   * natural dimensions (see {@link frameLockFromCenterCrop}). When omitted the
   * captured still displays at its full natural aspect.
   */
  capturedFrameLock?: FrameLock;
  /**
   * When true, an auto-capture is in flight (frame captured, post-processing): the
   * primary CTA shows a spinner and the secondary CTA + header chrome are locked.
   * Independent of `countdownSeconds`.
   */
  busy?: boolean;
  /** Optional override for the body copy in error/denied/unavailable states. */
  errorMessage?: ReactNode;
  /**
   * From `status: "idle"` — request camera permission (host calls `getUserMedia`).
   * Optional: when omitted, the idle CTA is hidden — useful when the host has
   * already auto-fired the request (browser permission state was `granted`).
   */
  onRequestPermission?: () => void;
  /** From `status: "live"` without a running countdown — start the self-timer countdown. */
  onStartSelfTimer: () => void;
  /** From `status: "live"` with an active countdown — cancel it. Optional when timer is disabled. */
  onCancelSelfTimer?: () => void;
  /** From `denied` / `unavailable` / `error` — re-attempt `getUserMedia`. */
  onRetry?: () => void;
  /**
   * From `status: "live"` — cycle to the next available video input. When
   * omitted (host has 0–1 cameras), the switcher button is hidden.
   */
  onSwitchCamera?: () => void;
  /**
   * Ghost CTA under the primary — bail out of the camera into the system file picker
   * ("Bild aus Mediathek hochladen" in the reference). Rendered in every state except
   * `uploading`; it doubles as the escape hatch when the camera is denied or unavailable.
   * Omit to hide the control.
   */
  onUploadFromLibrary?: () => void;
  onBack: () => void;
  onClose: () => void;
}

const DEFAULT_SELF_TIMER_SECONDS = 10;

function PhotoCaptureUploadingPreview({
  previewSrc,
  capturedFrameLock,
  busyLabel,
}: {
  previewSrc: string;
  capturedFrameLock?: FrameLock | undefined;
  busyLabel: string;
}) {
  const previewFrame = useNaturalAspectPreviewFrame(previewSrc, capturedFrameLock, {
    scrollAware: false,
  });

  return (
    <NaturalAspectPreviewFrame
      {...previewFrame}
      previewSrc={previewSrc}
      alt=""
      data-studio-vaai="photo-capture-uploading-preview"
      {...(capturedFrameLock === undefined ? {} : { frameLock: capturedFrameLock })}
      overlay={
        <div className="sv:pointer-events-none sv:absolute sv:inset-0 sv:flex sv:items-center sv:justify-center sv:rounded-[var(--sv-radius-button-primary)] sv:bg-black/35">
          <Spinner label={busyLabel} className="sv:size-10 sv:text-white" />
        </div>
      }
    />
  );
}

/**
 * Browser camera capture screen — live preview with auto-capture and self-timer CTAs.
 *
 * The component is presentational: the host owns the {@link MediaStream} lifecycle
 * (request, stop, error mapping) and drives `status` accordingly. This keeps
 * `getUserMedia` constraints, permission persistence, and pose-detection out of
 * the SDK surface.
 */
export function PhotoCaptureScreen({
  status,
  stream = null,
  previewSrc,
  mirrored = true,
  countdownSeconds = null,
  selfTimerDurationSeconds = DEFAULT_SELF_TIMER_SECONDS,
  videoRef: externalVideoRef,
  previewAspectRatio,
  onFrameLockChange,
  capturedFrameLock,
  busy = false,
  errorMessage,
  onRequestPermission,
  onStartSelfTimer,
  onCancelSelfTimer,
  onRetry,
  onSwitchCamera,
  onUploadFromLibrary,
  onBack,
  onClose,
}: PhotoCaptureScreenProps) {
  const { messages, responsive } = useStudioVaaiUi();
  const m = messages.photoCapture;
  const isModal = responsive.layout === "modal";
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const {
    aspectRatio: liveFrameAspect,
    frameFitClass: previewFrameFitClass,
    frameStyle: previewFrameStyle,
  } = usePreviewBaselineAspect(previewAspectRatio);

  // Surface the live frame's aspect to the host so it can stamp the captured
  // `FrameLock` at shutter time. The captured Blob is the full sensor frame;
  // this aspect tells the host what center-crop the user composed within.
  useEffect(() => {
    onFrameLockChange?.(liveFrameAspect);
  }, [liveFrameAspect, onFrameLockChange]);

  // Attach/detach the stream to the <video> element imperatively. React doesn't
  // expose `srcObject` as a prop, and assigning via JSX would coerce to a string.
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) {
      return;
    }
    el.srcObject = stream;
  }, [stream, videoRef]);

  useCanvasMediaPreview({
    videoRef,
    canvasRef,
    enabled: status === "live",
    mirrored,
  });

  const countdownActive = typeof countdownSeconds === "number" && countdownSeconds > 0;
  const controlsLocked = busy || countdownActive;

  // The modal stacks its CTA full-width at the foot of the column beside the preview (as the
  // design draws it); the sheet keeps the shell footer. Only the button shape differs, so the
  // action itself is built once here and placed by layout below.
  let primaryCta: ReactNode = null;
  if (status === "idle") {
    // CTA is opt-in: when the host has already auto-fired `getUserMedia`
    // (permission `granted`), the idle window is brief and there's nothing
    // useful for the user to click. Render the CTA only when supplied.
    if (onRequestPermission !== undefined) {
      primaryCta = (
        <Button
          type="button"
          variant="default"
          className={isModal ? flowPrimaryCtaClassName : undefined}
          onClick={onRequestPermission}
        >
          {m.allowCameraCta}
        </Button>
      );
    }
  } else if (status === "live") {
    // Live state currently exposes the self-timer only; auto-capture (pose
    // detection) is intentionally not surfaced. The self-timer button flips
    // to a cancel button while the countdown is running.
    primaryCta = countdownActive ? (
      <Button
        type="button"
        variant="default"
        className={isModal ? flowPrimaryCtaClassName : undefined}
        disabled={busy || onCancelSelfTimer === undefined}
        onClick={onCancelSelfTimer}
      >
        {m.cancelTimerCta}
      </Button>
    ) : (
      <Button
        type="button"
        variant="default"
        className={isModal ? flowPrimaryCtaClassName : undefined}
        busy={busy}
        busyLabel={m.busyAutoCaptureSr}
        disabled={controlsLocked}
        onClick={onStartSelfTimer}
      >
        {m.selfTimerCta(selfTimerDurationSeconds)}
      </Button>
    );
  } else if (
    (status === "denied" || status === "unavailable" || status === "error") &&
    onRetry !== undefined
  ) {
    primaryCta = (
      <Button
        type="button"
        variant="default"
        className={isModal ? flowPrimaryCtaClassName : undefined}
        onClick={onRetry}
      >
        {m.retry}
      </Button>
    );
  }

  // The library fallback rides under the primary in every state but `uploading` — on the live
  // frame it mirrors the reference's ghost line, and on denied/unavailable it is the one way
  // forward that needs no camera at all.
  const secondaryCta =
    onUploadFromLibrary === undefined || status === "uploading" ? null : (
      <Button
        type="button"
        variant="ghost"
        className={isModal ? flowSecondaryCtaClassName : undefined}
        disabled={controlsLocked}
        onClick={onUploadFromLibrary}
      >
        {m.uploadFromLibraryCta}
      </Button>
    );

  const footer =
    primaryCta === null && secondaryCta === null ? null : (
      <ActionsSection
        primary={primaryCta}
        {...(secondaryCta === null ? {} : { secondary: secondaryCta })}
      />
    );

  // How to stand for the shot. On the sheet it overlays the bottom of the preview (there is no
  // room beside it); in the modal it becomes a card in the column next to the preview, so it
  // never covers the frame the user is composing in.
  /**
   * What the right-hand column says while the capture uploads. Without it that column was empty
   * — no guidance (it is `live`-only), no CTA (both are suppressed while busy) — so a shopper who
   * had just been photographed saw a still frame and nothing else, and read it as the flow having
   * stalled. The spinner over the photo alone is easy to miss on a large screen.
   */
  const busyCard = (
    <div className="sv:flex sv:items-center sv:gap-2.5 sv:rounded-[var(--sv-radius-control)] sv:bg-[var(--sv-color-muted)] sv:px-4 sv:py-3">
      <Spinner
        aria-hidden
        label=""
        className="sv:size-4 sv:text-[var(--sv-color-foreground-secondary)]"
      />
      <Text variant="bodySecondary" className="sv:min-w-0">
        {m.busyUpload}
      </Text>
    </div>
  );

  const infoCard = (
    <div
      className={cn(
        "sv:flex sv:items-start sv:gap-2 sv:px-4 sv:py-3",
        isModal
          ? "sv:rounded-[var(--sv-radius-control)] sv:bg-[var(--sv-color-muted)]"
          : "sv:absolute sv:inset-x-0 sv:bottom-0 sv:rounded-xl sv:bg-white/60 sv:backdrop-blur-xs",
      )}
    >
      <span
        aria-hidden
        className="sv:mt-[2px] sv:inline-flex sv:h-5 sv:w-5 sv:shrink-0 sv:items-center sv:justify-center sv:text-[var(--sv-color-foreground)]"
      >
        <IconInfo className="sv:h-5 sv:w-5" />
      </span>
      <Text variant="body" className="sv:min-w-0 sv:flex-1">
        {m.infoBody}
      </Text>
    </div>
  );

  let errorBody: ReactNode = m.fallbackError;
  if (errorMessage !== undefined) {
    errorBody = errorMessage;
  } else if (status === "denied") {
    errorBody = m.permissionDeniedBody;
  } else if (status === "unavailable") {
    errorBody = m.unavailableBody;
  }

  // Live / idle / error keep the surface's baseline aspect — the user is
  // actively composing within that bbox. The uploading state renders the
  // captured still at the natural aspect of its FrameLock-cropped rect (by
  // construction that equals the live frame, but the source of truth has
  // shifted from a hardcoded baseline to the sidecar the host stamped at
  // shutter time, so non-camera Blobs would shrink-wrap to their own aspect).

  let body: ReactNode;
  if (status === "uploading" && previewSrc !== undefined) {
    // No CSS mirror here; the host bakes the horizontal flip into the canvas
    // during capture (see `captureFrameAsJpeg`), so the Blob already
    // represents the mirror the user saw. Adding `scaleX(-1)` would double-flip.
    body = (
      <PhotoCaptureUploadingPreview
        previewSrc={previewSrc}
        capturedFrameLock={capturedFrameLock}
        busyLabel={m.busyUpload}
      />
    );
  } else if (status === "live" || status === "idle") {
    const previewLayer: ReactNode =
      status === "live" ? (
        <>
          <canvas
            ref={canvasRef}
            data-studio-vaai="photo-capture-preview"
            className="sv:absolute sv:inset-0 sv:h-full sv:w-full"
          />
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            controls={false}
            controlsList="nodownload nofullscreen noplaybackrate"
            className="sv:hidden"
          />
        </>
      ) : (
        <div className="sv:flex sv:flex-col sv:items-center sv:gap-3 sv:px-6 sv:py-10 sv:text-center sv:text-white">
          <span
            aria-hidden
            className="sv:inline-flex sv:h-12 sv:w-12 sv:items-center sv:justify-center sv:rounded-full sv:bg-white/15"
          >
            <IconCamera className="sv:h-6 sv:w-6" />
          </span>
          <Text variant="body" className="sv:text-white/85">
            {m.permissionPromptBody}
          </Text>
        </div>
      );
    body = (
      <div
        className={cn(
          "sv:relative sv:flex sv:items-center sv:justify-center sv:overflow-hidden sv:rounded-xl sv:bg-black",
          previewFrameFitClass,
        )}
        style={previewFrameStyle}
      >
        {previewLayer}
        {countdownActive ? (
          <div
            role="status"
            aria-live="polite"
            aria-label={m.countdownSr(countdownSeconds ?? 0)}
            className="sv:pointer-events-none sv:absolute sv:inset-0 sv:flex sv:items-center sv:justify-center"
          >
            <span
              aria-hidden
              className="sv:flex sv:h-28 sv:w-28 sv:items-center sv:justify-center sv:rounded-full sv:bg-black/45 sv:text-5xl sv:font-medium sv:tabular-nums sv:text-white"
            >
              {countdownSeconds}
            </span>
          </div>
        ) : null}
        {status === "live" && onSwitchCamera !== undefined && !controlsLocked ? (
          <button
            type="button"
            onClick={onSwitchCamera}
            aria-label={m.switchCameraSr}
            className="sv:absolute sv:right-3 sv:top-3 sv:inline-flex sv:h-9 sv:w-9 sv:items-center sv:justify-center sv:rounded-full sv:bg-black/45 sv:text-white sv:backdrop-blur-sm sv:hover:bg-black/60"
          >
            <IconSwitchCamera className="sv:h-5 sv:w-5" />
          </button>
        ) : null}
        {status === "live" && !isModal ? infoCard : null}
      </div>
    );
  } else {
    const heading = status === "denied" ? m.permissionDeniedTitle : null;
    // Lock the failure body to the same aspect ratio as the live preview so
    // the sheet doesn't reflow between states. `overflow-hidden` keeps the
    // rounded corners clipping cleanly; content stays centered inside via
    // `justify-center` and the failure copy is short enough to fit at any
    // reasonable sheet width.
    body = (
      <div
        className={cn(
          "sv:flex sv:flex-col sv:items-center sv:justify-center sv:gap-3 sv:overflow-hidden sv:rounded-xl sv:bg-[var(--sv-color-muted)] sv:px-6 sv:py-10",
          previewFrameFitClass,
        )}
        style={previewFrameStyle}
      >
        <span
          aria-hidden
          className="sv:inline-flex sv:h-12 sv:w-12 sv:items-center sv:justify-center sv:rounded-full sv:bg-white sv:text-[var(--sv-color-foreground)]"
        >
          <IconAlertCircle className="sv:h-6 sv:w-6" />
        </span>
        {heading === null ? null : (
          <Text
            variant="body"
            render={(props) => {
              // oxlint-disable-next-line jsx-a11y/heading-has-content
              return <h2 {...props} />;
            }}
            className="sv:w-full sv:text-center sv:font-medium"
          >
            {heading}
          </Text>
        )}
        <Text
          variant="body"
          role={status === "error" ? "alert" : undefined}
          className="sv:w-full sv:text-center"
        >
          {errorBody}
        </Text>
      </div>
    );
  }

  return (
    <SheetShell
      title={m.title}
      subtitle={m.subtitle}
      // Modal carries its action in the right-hand column, so it renders no footer bar —
      // a footer would strand the CTA in its own strip below an already-tall dialog.
      {...(isModal ? {} : { footer })}
      busy={controlsLocked}
      fillHeight
      fillViewport
      scrollable={false}
      onBack={onBack}
      onClose={onClose}
    >
      {isModal ? (
        <ResponsiveSplit
          start={body}
          end={
            // A 2-row grid, not a flex column, so the guidance can centre against the PREVIEW
            // rather than against what is left over above the CTA. The preview is centred in its
            // own full-height column; centring the guidance in (column − CTA) put its middle
            // ~60px higher, which is what read as misaligned. Here the guidance spans BOTH rows
            // and self-centres, so it centres over the column's full height — the same box the
            // preview centres in — while the CTA still occupies the bottom row, flush to the
            // foot. They cannot collide in practice: the modal carries a min-height and the
            // guidance is a single short card.
            <div className="sv:grid sv:h-full sv:min-h-0 sv:min-w-0 sv:grid-rows-[1fr_auto] sv:gap-4">
              <div className="sv:col-start-1 sv:row-start-1 sv:row-end-3 sv:self-center">
                {status === "live" ? infoCard : null}
                {status === "uploading" ? busyCard : null}
              </div>
              {primaryCta === null && secondaryCta === null ? null : (
                <div className="sv:col-start-1 sv:row-start-2 sv:flex sv:w-full sv:flex-col sv:gap-2 sv:self-end">
                  {primaryCta}
                  {secondaryCta}
                </div>
              )}
            </div>
          }
          endClassName="sv:min-h-0"
        />
      ) : (
        body
      )}
    </SheetShell>
  );
}
