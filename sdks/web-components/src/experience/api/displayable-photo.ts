import { decodeJpegXl } from "@studio-vaai/core";

const PHOTO_READ_TIMEOUT_MS = 20_000;

/** Whether the browser decodes `blob` itself. */
async function decodes(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function") {
    return true;
  }
  try {
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/** Whether any pixel of `rgba` is not fully opaque. */
export function hasTransparency(rgba: ArrayLike<number>): boolean {
  for (let alpha = 3; alpha < rgba.length; alpha += 4) {
    if (rgba[alpha] !== 255) {
      return true;
    }
  }
  return false;
}

/**
 * The core's JPEG XL decoding of `bytes`, as an image the page can show: a PNG where it has
 * transparency (the person cut-out of a restored session), so it stays a cut-out on the stage,
 * otherwise a JPEG.
 */
async function decodedImage(bytes: ArrayBuffer): Promise<Blob | undefined> {
  const image = decodeJpegXl(bytes);
  if (image === undefined) {
    return undefined;
  }
  const rgba = new Uint8ClampedArray(image.rgba);
  const type = hasTransparency(rgba) ? "image/png" : "image/jpeg";
  const pixels = new ImageData(rgba, image.width, image.height);
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext("2d")?.putImageData(pixels, 0, 0);
    return await canvas.convertToBlob({ type, quality: 0.92 });
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(pixels, 0, 0);
  const { promise, resolve } = Promise.withResolvers<Blob | null>();
  canvas.toBlob(resolve, type, 0.92);
  return (await promise) ?? undefined;
}

/**
 * A restored source photo as the page can show it: the person cut-out try-ons render from, with
 * transparency around the person, which the stage shows through. The API keeps it as JPEG XL behind a signed
 * URL on its storage origin. Loaded by an `<img>` without CORS, a browser that cannot decode JPEG
 * XL cannot recognise it either, and Opaque Response Blocking stops it before it is decoded
 * (ERR_BLOCKED_BY_ORB). Read over CORS, it shows from a same-origin blob: as stored where the
 * browser decodes it, otherwise as the core decodes it. When it cannot be read or decoded, the
 * signed URL stays, as before.
 */
export async function displayablePhoto(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  if (!/^https?:/iu.test(url) || typeof URL.createObjectURL !== "function") {
    return url;
  }
  try {
    const response = await fetchImpl(url, {
      credentials: "omit",
      mode: "cors",
      signal: AbortSignal.any([signal, AbortSignal.timeout(PHOTO_READ_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      return url;
    }
    const blob = await response.blob();
    const shown = (await decodes(blob)) ? blob : await decodedImage(await blob.arrayBuffer());
    return shown === undefined ? url : URL.createObjectURL(shown);
  } catch {
    signal.throwIfAborted();
    return url;
  }
}

/** Lets go of a photo `displayablePhoto` made. */
export function releasePhoto(src: string | undefined): void {
  if (src?.startsWith("blob:") === true) {
    URL.revokeObjectURL(src);
  }
}
