import { heicTo } from "heic-to/next";

// Worker.postMessage has no targetOrigin parameter.
// oxlint-disable unicorn/require-post-message-target-origin
async function convert(blob: unknown): Promise<void> {
  try {
    // The parent admits the immutable Blob before starting this private worker.
    if (!(blob instanceof Blob)) {
      globalThis.postMessage(null);
      return;
    }
    const jpeg = await heicTo({ blob, type: "image/jpeg", quality: 0.85 });
    globalThis.postMessage(jpeg);
  } catch {
    globalThis.postMessage(null);
  }
}
// This module is bundled as a separate worker; it is never imported by the host.
globalThis.addEventListener(
  "message",
  (event: MessageEvent<unknown>) => {
    void convert(event.data);
  },
  { once: true },
);
