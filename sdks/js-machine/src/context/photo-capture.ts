import type { StandardError } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

import type { FrameLock, JsMachineInput } from "./shared.js";

/**
 * Why the camera flow could not produce a frame. Host maps `getUserMedia` errors
 * to one of these and dispatches `CAMERA_FAILED` with the kind set; the screen
 * picks the right copy (denied / unavailable / error).
 *
 * - `denied`: `NotAllowedError` / permission rejection.
 * - `unavailable`: `NotFoundError` / `OverconstrainedError` / no usable camera.
 * - `error`: anything else (`NotReadableError`, transient device failure, …).
 */
export type CameraFailureKind = "denied" | "unavailable" | "error";

export interface PhotoCaptureContext {
  client: StudioVaaiClient;
  session: SessionHandle;
  /**
   * Seconds remaining on the self-timer. Set when the `countdown` state is
   * entered, decremented on each tick, cleared on cancel / completion.
   */
  countdownSeconds?: number | undefined;
  /** Initial self-timer duration; configurable via input (defaults to 10s). */
  selfTimerDurationSeconds: number;
  /** Discriminator for the `failed` state's UI copy. */
  lastFailureKind?: CameraFailureKind | undefined;
  /** Free-form error payload from the host (mapped at the boundary). */
  lastError?: StandardError | undefined;
  /**
   * Resulting frame; set on `FRAME_CAPTURED` and surfaced as the machine's
   * output. `frameLock` is the composition bbox the user saw during live
   * preview, captured at shutter time so downstream display can re-create the
   * same crop without baking it into the Blob.
   */
  capturedImage?: { type: "blob"; blob: Blob; frameLock?: FrameLock } | undefined;
}

export interface PhotoCaptureInput extends JsMachineInput {
  session: SessionHandle;
  /** Self-timer duration in seconds. Defaults to 10. */
  selfTimerDurationSeconds?: number;
}
