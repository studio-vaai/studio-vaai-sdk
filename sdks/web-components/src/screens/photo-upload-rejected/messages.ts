import type { SvUiContext } from "../../ui/index.js";

/** Screen-local mapping of the shared Rust MF2 catalog. */
export function photoUploadRejectedMessages(ui: SvUiContext) {
  return {
    title: ui.text("photoUpload.title"),
    error: ui.text("photoUpload.fallbackError"),
    upload: ui.text("photoUpload.primaryRetry"),
    guide: ui.text("photoUpload.guideLink"),
    uploading: ui.text("photoUpload.busyRetryUploadSr"),
  };
}
