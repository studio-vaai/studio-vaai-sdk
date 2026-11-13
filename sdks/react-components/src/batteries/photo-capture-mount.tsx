"use client";

import type { CameraFailureKind, FrameLock, PhotoCaptureSnapshot } from "@studio-vaai/js-machine";
import type { AnyActorRef } from "xstate";

import { frameLockFromCenterCrop } from "@studio-vaai/js-machine";
import { useCallback, useEffect, useRef, useState } from "react";

import { PhotoCaptureScreen, type PhotoCaptureScreenStatus } from "./photo-capture-screen.js";

/**
 * Browser-reported camera permission state. Tracks the Permissions API result;
 * `null` means the query failed or is still resolving (treat as "unknown" — the
 * host's policy in that case is the same as `prompt`).
 */
type CameraPermissionState = "granted" | "denied" | "prompt" | null;

/**
 * Subscribe to `navigator.permissions.query({ name: "camera" })`. Best-effort:
 * older Safari / Firefox builds don't ship the `camera` permission name and the
 * query rejects — we surface `null` and the caller treats that like `prompt`.
 */
function useCameraPermissionState(): CameraPermissionState {
  const [state, setState] = useState<CameraPermissionState>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.permissions === undefined) {
      return;
    }
    let cancelled = false;
    // Default is no-op until the async query resolves; reassigned in the
    // success path so cleanup can remove the change listener.
    // oxlint-disable-next-line eslint-plugin-unicorn/no-empty-function -- placeholder until the async query resolves and assigns a real detach.
    let detach: () => void = () => {};
    const run = async (): Promise<void> => {
      try {
        // TS' standard `PermissionName` union doesn't include "camera"; the
        // browser does. Cast at the boundary.
        const status = await navigator.permissions.query({
          name: "camera",
        });
        if (cancelled) {
          return;
        }
        setState(status.state);
        const onChange = (): void => {
          setState(status.state);
        };
        status.addEventListener("change", onChange);
        detach = (): void => {
          status.removeEventListener("change", onChange);
        };
      } catch {
        // Permission name not supported (older Safari/Firefox) — leave `null`.
      }
    };
    void run();
    return () => {
      cancelled = true;
      detach();
    };
  }, []);
  return state;
}

/**
 * Map a browser `getUserMedia` rejection to the {@link CameraFailureKind} the
 * machine + screen consume. Names come from the Permissions / WebRTC specs;
 * anything we don't recognise becomes a generic `error`.
 */
function failureKindFromError(err: unknown): CameraFailureKind {
  if (err === null || err === undefined) {
    return "error";
  }
  const { name } = err as { name?: unknown };
  if (typeof name !== "string") {
    return "error";
  }
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  ) {
    return "unavailable";
  }
  return "error";
}

/**
 * Map the camera child's machine state to the screen's UI status. `idle`
 * encompasses both pre-permission (host hasn't fired getUserMedia yet) and
 * in-flight permission prompt — visually identical from the user's POV.
 */
function statusFromSnapshot(snap: PhotoCaptureSnapshot | null): PhotoCaptureScreenStatus {
  if (snap === null) {
    return "idle";
  }
  if (snap.matches("awaitingPermission")) {
    return "idle";
  }
  if (snap.matches("live") || snap.matches("countdown") || snap.matches("capturing")) {
    return "live";
  }
  if (snap.matches("failed")) {
    return snap.context.lastFailureKind ?? "error";
  }
  return "idle";
}

/**
 * Capture a JPEG frame from the live video element by drawing it to a
 * detached canvas. Throws on encoder failure; the host machine drops back to
 * `live` on a thrown `CAPTURE_FAILED`.
 *
 * When `mirrored` is true the canvas is horizontally flipped before drawing so
 * the encoded Blob matches the mirror-style live preview the user actually
 * saw. The live `<video>` element uses CSS `scaleX(-1)` for that mirror, but
 * `drawImage` reads raw pixels — without baking the flip here the captured
 * still would be horizontally reversed compared to the live preview.
 */
interface CaptureFrameResult {
  blob: Blob;
  /** Sensor dimensions, needed to derive the {@link FrameLock} for the live preview's bbox. */
  width: number;
  height: number;
}

async function captureFrameAsJpeg(
  video: HTMLVideoElement,
  mirrored: boolean,
): Promise<CaptureFrameResult> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) {
    throw new Error("photoCaptureMount: video has no dimensions yet");
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("photoCaptureMount: 2d context unavailable");
  }
  if (mirrored) {
    // Flip the X axis and draw at a negative x-offset so the destination rect
    // covers (0..w) in canvas coords with the source pixels reversed.
    // Equivalent to the canonical `translate(w, 0); scale(-1, 1)` pair but
    // avoids any browser-specific weirdness with the transform stack.
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
  } else {
    ctx.drawImage(video, 0, 0, w, h);
  }
  // oxlint-disable-next-line eslint-plugin-promise/avoid-new -- `canvas.toBlob` is a callback API; promisifying here is the only way to await it.
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (b) => {
        resolve(b);
      },
      "image/jpeg",
      0.92,
    );
  });
  if (blob === null) {
    throw new Error("photoCaptureMount: toBlob returned null");
  }
  return { blob, width: w, height: h };
}

interface PhotoCaptureMountProps {
  /** Camera child actor from `firstChildActor(rootActor)` while phase === "photoCapture". */
  camera: AnyActorRef;
  /** Dispatched when the user backs out of the camera flow. */
  onCancelCamera: () => void;
  /** Dispatched when the user closes the entire sheet. */
  onClose: () => void;
  /**
   * Opens the system file picker as the camera's fallback path ("Bild aus Mediathek
   * hochladen"). Passed through to {@link PhotoCaptureScreen.onUploadFromLibrary};
   * omit to hide the control.
   */
  onUploadFromLibrary?: () => void;
  /** Mirror the live preview. Defaults to true (front-facing camera convention). */
  mirrored?: boolean;
}

/**
 * Glue between the {@link photoCaptureMachine} child and {@link PhotoCaptureScreen}.
 *
 * Owns the {@link MediaStream} lifecycle: requests `getUserMedia` on mount, stops
 * tracks on unmount, and dispatches `CAMERA_READY` / `CAMERA_FAILED` so the
 * machine can route between `live` and `failed`. Also watches the machine for
 * `capturing` state entry and grabs a frame from the video element on demand —
 * the machine drives this so a countdown reaching zero produces a capture
 * automatically (no second wiring path).
 */
export function PhotoCaptureMount({
  camera,
  onCancelCamera,
  onClose,
  onUploadFromLibrary,
  mirrored = true,
}: PhotoCaptureMountProps) {
  const [snap, setSnap] = useState<PhotoCaptureSnapshot | null>(
    () => camera.getSnapshot() as PhotoCaptureSnapshot,
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureInFlightRef = useRef(false);
  const activeStreamRef = useRef<MediaStream | null>(null);
  // Cached aspect (width / height) of the live preview's composition bbox.
  // The screen pushes this in via `onFrameLockChange` whenever the responsive
  // layout flips; we read it at shutter time and combine with the encoded
  // frame's sensor dimensions to stamp a FrameLock onto the captured Blob.
  const liveFrameAspectRef = useRef<number | null>(null);
  const permissionState = useCameraPermissionState();
  // Bumped whenever the host needs a fresh getUserMedia call from outside the
  // effect's natural deps — `onRequestPermission` CTA click, on retry, etc.
  // Each bump triggers the request effect once.
  const [requestNonce, setRequestNonce] = useState(0);
  // Ensures we fire getUserMedia at most once per awaitingPermission cycle
  // (re-fires when permission state flips to granted, etc., would otherwise
  // stack on top of the existing in-flight request). Reset when the machine
  // leaves awaitingPermission.
  const firedThisAwaitingRef = useRef(false);
  // Camera switcher: a deliberate front/back toggle, NOT a cycle over every
  // enumerated video input. Phones expose each physical lens (back-main,
  // back-ultrawide, back-tele, front) as its own `videoinput`, so cycling
  // deviceIds walks through lenses; instead we flip `facingMode` and let the
  // browser pick the *default (main)* camera for that direction.
  // `canToggleFacing` (resolved once a stream exists) gates whether the
  // affordance is even meaningful — see the detection effect below.
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [canToggleFacing, setCanToggleFacing] = useState(false);

  // Subscribe to the camera child snapshot updates.
  useEffect(() => {
    setSnap(camera.getSnapshot() as PhotoCaptureSnapshot);
    const sub = camera.subscribe(() => {
      setSnap(camera.getSnapshot() as PhotoCaptureSnapshot);
    });
    return () => {
      sub.unsubscribe();
    };
  }, [camera]);

  // Stop any active stream tracks. Idempotent.
  //
  // We null the ref BEFORE calling `track.stop()` so the `ended` listener
  // attached below can tell its-our-stop apart from an unsolicited end
  // (browser revoked permission, OS muted the device, etc.).
  const stopActiveStream = useCallback((): void => {
    const s = activeStreamRef.current;
    if (s === null) {
      return;
    }
    activeStreamRef.current = null;
    for (const t of s.getTracks()) {
      t.stop();
    }
  }, []);

  // Mount-only cleanup: when the camera mount unmounts (sheet close, machine
  // accepted) make sure the camera light goes off.
  useEffect(
    () => () => {
      stopActiveStream();
    },
    [stopActiveStream],
  );

  // Reset the per-cycle fire guard whenever the machine leaves
  // `awaitingPermission`. Next entry (e.g. via RETRY) will fire fresh.
  const inAwaiting = snap !== null && snap.matches("awaitingPermission");
  useEffect(() => {
    if (!inAwaiting) {
      firedThisAwaitingRef.current = false;
    }
  }, [inAwaiting]);

  // Permission-aware decision effect — does NOT itself fire getUserMedia.
  //
  // Browser permission outcomes drive the behavior:
  // - `denied`: skip getUserMedia entirely; dispatch CAMERA_FAILED kind=denied
  //             so the screen lands directly on the recovery state.
  // - anything else (`granted`, `prompt`, `null`): auto-bump `requestNonce` so
  //             the fire effect runs immediately. The user already issued a
  //             gesture by clicking "Take photo" to reach this screen, so we
  //             want the browser permission popup to open without an extra
  //             click. For previously-granted permission the popup is
  //             skipped; for `prompt` it appears; for `null` (Permissions
  //             API unsupported) we just try. The CTA stays visible as a
  //             recovery affordance if the user dismissed the popup.
  //
  // CRITICAL: keep this separate from the fire effect. If permissionState
  // were a dep of the fire effect, the prompt → granted transition that
  // happens while `getUserMedia` is in flight (user clicks Allow in the
  // browser) would re-run the effect, the cleanup would set `cancelled =
  // true`, and the resolving stream would be stopped without dispatching
  // CAMERA_READY — the screen would get stuck on "Allow permissions".
  useEffect(() => {
    if (!inAwaiting || firedThisAwaitingRef.current) {
      return;
    }
    // Honor cached-denied ONLY on the initial mount path (nonce === 0). After
    // an explicit retry the user may have just toggled the OS / browser
    // permission, so we always issue a real getUserMedia call and let the
    // browser produce the up-to-date decision.
    if (permissionState === "denied" && requestNonce === 0) {
      firedThisAwaitingRef.current = true;
      camera.send({ type: "CAMERA_FAILED", kind: "denied" });
      return;
    }
    if (requestNonce === 0) {
      setRequestNonce(1);
    }
  }, [camera, inAwaiting, permissionState, requestNonce]);

  // Request fire effect — depends ONLY on `requestNonce` + `inAwaiting`, so a
  // permission-state change while a request is in flight cannot cancel it.
  // Cleanup deliberately does NOT stop tracks; the stream survives the
  // transition into `live` / `countdown` / `capturing`. Tracks are stopped
  // either at unmount or at the next `awaitingPermission` entry.
  useEffect(() => {
    if (!inAwaiting || requestNonce === 0 || firedThisAwaitingRef.current) {
      return;
    }
    firedThisAwaitingRef.current = true;
    stopActiveStream();
    setStream(null);
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        // Prefer the current facing direction as an "ideal" hint: non-binding
        // so a browser without front/back metadata (most desktops) still
        // picks something reasonable rather than failing. The hard front/back
        // guarantee lives in `onSwitchCamera` (exact facingMode); here we only
        // want a sane default and to honour the last-chosen facing on retry.
        const videoConstraints: MediaTrackConstraints = {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
        const s = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        if (cancelled) {
          for (const t of s.getTracks()) {
            t.stop();
          }
          return;
        }
        activeStreamRef.current = s;
        setStream(s);
        camera.send({ type: "CAMERA_READY" });
      } catch (error) {
        if (cancelled) {
          return;
        }
        camera.send({ type: "CAMERA_FAILED", kind: failureKindFromError(error) });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [camera, inAwaiting, requestNonce, facingMode, stopActiveStream]);

  // Mid-stream permission revocation watcher — Permissions API path.
  //
  // While the stream is live (or counting down / capturing) we monitor the
  // Permissions API for a flip to `denied`. The user can revoke camera access
  // via browser settings without ending the existing stream's tracks (in some
  // browsers); the Permissions state change is the only reliable signal.
  // Re-entry into `awaitingPermission` is handled separately (the decide
  // effect above), so this is gated on NOT being in that state.
  const liveOrBusy =
    snap !== null &&
    (snap.matches("live") || snap.matches("countdown") || snap.matches("capturing"));
  useEffect(() => {
    if (!liveOrBusy || permissionState !== "denied") {
      return;
    }
    camera.send({ type: "CAMERA_FAILED", kind: "denied" });
  }, [camera, liveOrBusy, permissionState]);

  // Mid-stream revocation watcher — MediaStreamTrack `ended` + `mute` paths.
  //
  // The Permissions API doesn't fire in every revocation path (e.g. OS-level
  // device lock, hardware disconnect, the user picking "Stop sharing" from
  // the browser indicator). The track's `ended` event is the catch-all for
  // hard stops. `mute` covers soft stops: hardware privacy switch, Windows
  // privacy toggle, another tab grabbing exclusive access — the track stays
  // live but produces black frames. Either way we surface it as a failure.
  // We skip the dispatch when we initiated the stop ourselves — detected via
  // `activeStreamRef.current === null` (which `stopActiveStream` nulls BEFORE
  // calling `track.stop`).
  useEffect(() => {
    if (stream === null) {
      return;
    }
    const tracks = stream.getTracks();
    const onTrackEnded = (): void => {
      if (activeStreamRef.current === null) {
        // Our own stopActiveStream call — ignore.
        return;
      }
      camera.send({ type: "CAMERA_FAILED", kind: "denied" });
    };
    const onTrackMuted = (): void => {
      if (activeStreamRef.current === null) {
        return;
      }
      // `mute` can be transient (hardware switch, app stealing focus); we
      // bail to the failure screen rather than rendering a frozen preview.
      // User clicks retry → fresh getUserMedia attempt. If the mute cleared
      // by then, the next stream comes up unmuted.
      camera.send({ type: "CAMERA_FAILED", kind: "error" });
    };
    for (const t of tracks) {
      t.addEventListener("ended", onTrackEnded);
      t.addEventListener("mute", onTrackMuted);
    }
    return () => {
      for (const t of tracks) {
        t.removeEventListener("ended", onTrackEnded);
        t.removeEventListener("mute", onTrackMuted);
      }
    };
  }, [camera, stream]);

  // Tab visibility watcher — backgrounded tabs lose their stream in mobile
  // Safari (and sometimes desktop Chrome under power saver), but the track
  // `ended` event doesn't always fire reliably. When the tab becomes visible
  // again, check whether every track is still `live`; if any died while we
  // weren't looking, surface the failure so the user can retry.
  useEffect(() => {
    if (stream === null) {
      return;
    }
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        return;
      }
      if (activeStreamRef.current === null) {
        return;
      }
      const tracks = activeStreamRef.current.getTracks();
      const anyDead = tracks.some((t) => t.readyState === "ended" || !t.enabled);
      if (anyDead) {
        camera.send({ type: "CAMERA_FAILED", kind: "error" });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [camera, stream]);

  // Selfie mirroring is a front-camera convention; the back camera shows the
  // world as-is. The `mirrored` prop is the host's preference for the
  // front-facing case — we suppress it once the user flips to `environment`.
  const effectiveMirrored = mirrored && facingMode === "user";

  // When the machine enters `capturing`, grab a frame from the video element
  // and dispatch FRAME_CAPTURED (or CAPTURE_FAILED).
  const inCapturing = snap !== null && snap.matches("capturing");
  useEffect(() => {
    if (!inCapturing || captureInFlightRef.current) {
      return;
    }
    const video = videoRef.current;
    if (video === null) {
      camera.send({ type: "CAPTURE_FAILED" });
      return;
    }
    captureInFlightRef.current = true;
    const run = async (): Promise<void> => {
      try {
        const { blob, width, height } = await captureFrameAsJpeg(video, effectiveMirrored);
        const aspect = liveFrameAspectRef.current;
        let frameLock: FrameLock | undefined;
        if (aspect !== null && Number.isFinite(aspect) && aspect > 0) {
          frameLock = frameLockFromCenterCrop({ width, height }, aspect);
        }
        camera.send({
          type: "FRAME_CAPTURED",
          image: {
            type: "blob",
            blob,
            ...(frameLock === undefined ? {} : { frameLock }),
          },
        });
      } catch {
        camera.send({ type: "CAPTURE_FAILED" });
      } finally {
        captureInFlightRef.current = false;
      }
    };
    void run();
  }, [camera, inCapturing, effectiveMirrored]);

  const onFrameLockChange = useCallback((aspect: number): void => {
    liveFrameAspectRef.current = aspect;
  }, []);

  const status = statusFromSnapshot(snap);
  const countdownSeconds = snap?.context.countdownSeconds ?? null;
  const selfTimerDurationSeconds = snap?.context.selfTimerDurationSeconds ?? 10;
  const busy = inCapturing;

  // CTA visibility: only when the machine is awaiting permission AND the
  // browser hasn't already pre-decided (granted → auto-fire; denied → failed).
  // For granted, the request fires before this even renders; for denied we
  // skip the idle screen entirely.
  const showRequestCta =
    inAwaiting && permissionState !== "granted" && permissionState !== "denied";

  const onRequestPermission = useCallback(() => {
    // Re-runs the request effect for the current `awaitingPermission` cycle
    // by bumping the nonce, which clears `firedThisAwaitingRef` via the
    // gate. Used when the browser permission state is `prompt` / unknown,
    // or when the previous prompt was dismissed without a choice.
    firedThisAwaitingRef.current = false;
    setRequestNonce((n) => n + 1);
  }, []);

  const onStartSelfTimer = useCallback(() => {
    camera.send({ type: "START_SELF_TIMER" });
  }, [camera]);

  const onCancelSelfTimer = useCallback(() => {
    camera.send({ type: "CANCEL_SELF_TIMER" });
  }, [camera]);

  const onRetry = useCallback(() => {
    // Retry implies "fire getUserMedia again" — bump the nonce so the next
    // awaitingPermission cycle (entered via RETRY) fires immediately even when
    // the permission state is `prompt` / unknown.
    firedThisAwaitingRef.current = false;
    setRequestNonce((n) => n + 1);
    camera.send({ type: "RETRY" });
  }, [camera]);

  // Detect whether a front/back toggle is meaningful. Runs once a stream
  // exists (post-permission), where two reliable signals are available without
  // any label parsing:
  //   1. >1 video input device (a single-camera tablet has nothing to toggle).
  //   2. The active track reports `facingMode` — phones expose front/back
  //      semantics, desktop webcams don't. This excludes the 2-webcam laptop,
  //      where an `{ exact: "environment" }` switch would only throw.
  const switchInFlightRef = useRef(false);
  useEffect(() => {
    if (stream === null || canToggleFacing) {
      return;
    }
    if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
      return;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) {
          return;
        }
        const cameraCount = all.filter((d) => d.kind === "videoinput").length;
        const [track] = stream.getVideoTracks();
        const capabilities = track?.getCapabilities?.();
        const hasFacingSemantics =
          (capabilities?.facingMode?.length ?? 0) > 0 ||
          track?.getSettings().facingMode !== undefined;
        setCanToggleFacing(cameraCount > 1 && hasFacingSemantics);
      } catch {
        // enumerateDevices is best-effort; if it fails (no permission, etc.)
        // we just don't show the switcher.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [stream, canToggleFacing]);

  const onSwitchCamera = useCallback(() => {
    if (switchInFlightRef.current) {
      return;
    }
    // Flip front↔back and let the browser resolve the *default (main)* camera
    // for that direction via `facingMode: { exact }`. We bypass the fire
    // effect (gated on `awaitingPermission`) because we're switching while the
    // machine is already in `live`.
    const nextMode = facingMode === "user" ? "environment" : "user";
    switchInFlightRef.current = true;
    const run = async (): Promise<void> => {
      try {
        stopActiveStream();
        setStream(null);
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: nextMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        activeStreamRef.current = s;
        setStream(s);
        setFacingMode(nextMode);
      } catch (error) {
        camera.send({ type: "CAMERA_FAILED", kind: failureKindFromError(error) });
      } finally {
        switchInFlightRef.current = false;
      }
    };
    void run();
  }, [camera, facingMode, stopActiveStream]);

  const showSwitchCamera = canToggleFacing;

  return (
    <PhotoCaptureScreen
      status={status}
      stream={stream}
      mirrored={effectiveMirrored}
      countdownSeconds={countdownSeconds}
      selfTimerDurationSeconds={selfTimerDurationSeconds}
      videoRef={videoRef}
      onFrameLockChange={onFrameLockChange}
      busy={busy}
      {...(showRequestCta ? { onRequestPermission } : {})}
      onStartSelfTimer={onStartSelfTimer}
      onCancelSelfTimer={onCancelSelfTimer}
      onRetry={onRetry}
      {...(showSwitchCamera ? { onSwitchCamera } : {})}
      {...(onUploadFromLibrary === undefined ? {} : { onUploadFromLibrary })}
      onBack={onCancelCamera}
      onClose={onClose}
    />
  );
}
