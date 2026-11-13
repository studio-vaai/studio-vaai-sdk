import type { SvUiContext } from "../../ui/index.js";

/** The confirmation maps shared Rust MF2 copy onto the existing alert-dialog primitive. */
export function photoRetakeMessages(ui: SvUiContext) {
  return {
    title: ui.text("photoCapture.retakeTitle"),
    description: ui.text("photoCapture.retakeBody"),
    confirm: ui.text("photoCapture.retakeContinue"),
    cancel: ui.text("photoCapture.retakeCancel"),
  };
}
