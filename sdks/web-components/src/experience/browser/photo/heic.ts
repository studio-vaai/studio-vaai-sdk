import { assertImageByteSize, inspectImageHeader } from "./image-limits.js";

const HEIC_EXTENSION_PATTERN = /\.(heic|heif)$/i;
const DECODE_TIMEOUT_MS = 10_000;
let decoding = false;

/** HEIC decoding runs in a single-use worker with bounded input, lifetime and admission. */
export async function convertHeicToJpeg(
  blob: Blob,
  filename?: string,
  signal?: AbortSignal,
): Promise<Blob | undefined> {
  const likelyHeic =
    ["image/heic", "image/heif"].includes(blob.type.toLowerCase()) ||
    (typeof filename === "string" && HEIC_EXTENSION_PATTERN.test(filename));
  if (!likelyHeic || decoding || typeof Worker === "undefined") {
    return;
  }
  signal?.throwIfAborted();
  try {
    if (!(await inspectImageHeader(blob, signal))) {
      return;
    }
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    return;
  }
  if (decoding) {
    return;
  }
  decoding = true;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: (() => void) | null = null;
  try {
    const active = new Worker(new URL("heic-worker.ts", import.meta.url), { type: "module" });
    worker = active;
    // oxlint-disable-next-line eslint-plugin-promise/avoid-new -- worker events and cancellation are callback APIs.
    const result = await new Promise<Blob | null>((resolve, reject) => {
      abort = () => {
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new DOMException("Cancelled", "AbortError"));
      };
      active.addEventListener(
        "message",
        (event: MessageEvent<unknown>) => {
          const value = event.data;
          if (!(value instanceof Blob)) {
            resolve(null);
            return;
          }
          try {
            assertImageByteSize(value.size);
            resolve(value);
          } catch {
            resolve(null);
          }
        },
        { once: true },
      );
      active.addEventListener(
        "error",
        () => {
          resolve(null);
        },
        { once: true },
      );
      active.addEventListener(
        "messageerror",
        () => {
          resolve(null);
        },
        { once: true },
      );
      timer = setTimeout(() => {
        resolve(null);
      }, DECODE_TIMEOUT_MS);
      signal?.addEventListener("abort", abort, { once: true });
      signal?.throwIfAborted();
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no targetOrigin parameter.
      active.postMessage(blob);
    });
    if (result !== null) {
      return result;
    }
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (abort !== null) {
      signal?.removeEventListener("abort", abort);
    }
    worker?.terminate();
    decoding = false;
  }
  // oxlint-disable-next-line eslint/no-useless-return -- Explicit optional return is required by noImplicitReturns.
  return;
}
