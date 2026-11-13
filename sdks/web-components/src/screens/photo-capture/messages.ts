import type { SvUiContext } from "../../ui/index.js";

/** The screen composes shared Rust MF2 messages; locale and copy stay in the UI context. */
export function photoCaptureMessages(
  ui: SvUiContext,
  timerSeconds: number,
  countdownSeconds: number,
) {
  return {
    title: ui.text("photoCapture.title"),
    subtitle: ui.text("photoCapture.subtitle"),
    guidance: ui.text("photoCapture.infoBody"),
    permission: ui.text("photoCapture.permissionPromptBody"),
    allowCamera: ui.text("photoCapture.allowCameraCta"),
    upload: ui.text("photoCapture.uploadFromLibraryCta"),
    startTimer: ui.text("photoCapture.selfTimerCta", { seconds: timerSeconds }),
    cancelTimer: ui.text("photoCapture.cancelTimerCta"),
    deniedTitle: ui.text("photoCapture.permissionDeniedTitle"),
    deniedBody: ui.text("photoCapture.permissionDeniedBody"),
    unavailable: ui.text("photoCapture.unavailableBody"),
    error: ui.text("photoCapture.fallbackError"),
    retry: ui.text("photoCapture.retry"),
    processing: ui.text("photoCapture.busyAutoCaptureSr"),
    switchCamera: ui.text("photoCapture.switchCameraSr"),
    countdown: ui.text("photoCapture.countdownSr", { seconds: countdownSeconds }),
  };
}

export type PhotoCaptureMessages = ReturnType<typeof photoCaptureMessages>;
