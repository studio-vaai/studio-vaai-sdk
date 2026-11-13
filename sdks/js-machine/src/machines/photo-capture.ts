import { assign, setup, type SnapshotFrom } from "xstate";

import type {
  CameraFailureKind,
  FrameLock,
  PhotoCaptureContext,
  PhotoCaptureInput,
} from "../context/index.js";

export type PhotoCaptureEvent =
  /** Sent by the host once `getUserMedia` resolved and the stream is attached. */
  | { type: "CAMERA_READY" }
  /** Sent by the host when `getUserMedia` rejected. `kind` discriminates the UI copy. */
  | { type: "CAMERA_FAILED"; kind: CameraFailureKind }
  /** Host control: start the self-timer countdown from `selfTimerDurationSeconds`. */
  | { type: "START_SELF_TIMER" }
  /** Host control: cancel an in-flight countdown and return to `live`. */
  | { type: "CANCEL_SELF_TIMER" }
  /**
   * User tapped "automatic capture" while in `live`. Transitions to `capturing`;
   * the host should grab a frame from the video element and dispatch
   * `FRAME_CAPTURED` when the Blob is ready.
   */
  | { type: "AUTO_CAPTURE" }
  /**
   * Host: frame captured + encoded as a Blob. Becomes the machine output.
   * `image.frameLock` carries the composition bbox the user saw during live
   * preview (the Blob itself is the full sensor frame).
   */
  | {
      type: "FRAME_CAPTURED";
      image: { type: "blob"; blob: Blob; frameLock?: FrameLock };
    }
  /** Host: capture failed (canvas/encoding error). Drops back to `live`. */
  | { type: "CAPTURE_FAILED" }
  /** From `failed` — host should retry `getUserMedia`. */
  | { type: "RETRY" };

export type PhotoCaptureOutput = {
  image: NonNullable<PhotoCaptureContext["capturedImage"]>;
};

export const photoCaptureMachine = setup({
  types: {
    context: {} as PhotoCaptureContext,
    events: {} as PhotoCaptureEvent,
    input: {} as PhotoCaptureInput,
    output: {} as PhotoCaptureOutput,
  },
}).createMachine({
  id: "photoCapture",
  initial: "awaitingPermission",
  context: ({ input }) => ({
    client: input.client,
    session: input.session,
    selfTimerDurationSeconds: input.selfTimerDurationSeconds ?? 10,
    countdownSeconds: undefined,
    lastFailureKind: undefined,
    lastError: undefined,
    capturedImage: undefined,
  }),
  // Root-level CAMERA_FAILED handler catches revocations from any non-final
  // state — including mid-countdown and mid-capture. Hosts dispatch this when
  // the Permissions API flips to `denied` or when a live `MediaStreamTrack`
  // fires `ended` unexpectedly (browser-side revocation, OS lock, etc.).
  on: {
    CAMERA_FAILED: {
      target: ".failed",
      actions: assign({ lastFailureKind: ({ event }) => event.kind }),
    },
  },
  states: {
    awaitingPermission: {
      on: {
        CAMERA_READY: { target: "live" },
      },
    },
    live: {
      on: {
        START_SELF_TIMER: {
          target: "countdown",
          actions: assign({
            countdownSeconds: ({ context }) => context.selfTimerDurationSeconds,
          }),
        },
        AUTO_CAPTURE: { target: "capturing" },
      },
    },
    countdown: {
      // The machine owns the timer so it's deterministic in tests; host only
      // needs to render `context.countdownSeconds` and dispatch CANCEL.
      after: {
        1000: [
          {
            guard: ({ context }) => (context.countdownSeconds ?? 0) > 1,
            target: "countdown",
            reenter: true,
            actions: assign({
              countdownSeconds: ({ context }) => (context.countdownSeconds ?? 0) - 1,
            }),
          },
          {
            // Reached 0 → trigger capture. Clear the countdown so UI updates.
            target: "capturing",
            actions: assign({ countdownSeconds: undefined }),
          },
        ],
      },
      on: {
        CANCEL_SELF_TIMER: {
          target: "live",
          actions: assign({ countdownSeconds: undefined }),
        },
      },
    },
    capturing: {
      on: {
        FRAME_CAPTURED: {
          target: "accepted",
          actions: assign({ capturedImage: ({ event }) => event.image }),
        },
        CAPTURE_FAILED: { target: "live" },
      },
    },
    failed: {
      on: {
        RETRY: {
          target: "awaitingPermission",
          actions: assign({ lastFailureKind: undefined, lastError: undefined }),
        },
      },
    },
    accepted: { type: "final" },
  },
  output: ({ context }): PhotoCaptureOutput => {
    if (context.capturedImage === undefined) {
      throw new Error("photoCapture: missing capturedImage on output");
    }
    return { image: context.capturedImage };
  },
});

export type PhotoCaptureSnapshot = SnapshotFrom<typeof photoCaptureMachine>;
