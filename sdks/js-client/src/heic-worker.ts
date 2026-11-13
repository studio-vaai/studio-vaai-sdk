import { heicTo } from "heic-to/next";

import { inspectImageHeader, MAX_IMAGE_INPUT_BYTES } from "./image-limits.js";

// Worker.postMessage has no targetOrigin parameter.
// oxlint-disable unicorn/require-post-message-target-origin
async function convert(blob: unknown): Promise<void> {
  try {
    if (!(blob instanceof Blob) || !(await inspectImageHeader(blob))) {
      globalThis.postMessage(null);
      return;
    }
    const jpeg = await heicTo({ blob, type: "image/jpeg", quality: 0.85 });
    globalThis.postMessage(jpeg.size <= MAX_IMAGE_INPUT_BYTES ? jpeg : null);
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
