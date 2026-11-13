import type { ImageMetadataInput, ImageInput } from "../api/body.js";

import { readCameraMetadata } from "../camera-metadata.js";
import { convertHeicToJpeg } from "../heic.js";
import {
  assertImageByteSize,
  imageInputByteSize,
  assertImageDimensions,
  inspectImageHeader,
} from "../image-limits.js";

/**
 * Longest-edge cap for the uploaded image.
 */
const MAX_UPLOAD_LONG_EDGE = 2600;

/** JPEG quality for the downscaled upload. */
const UPLOAD_JPEG_QUALITY = 0.9;

interface PreparedUpload {
  /** The image to actually upload (downscaled when oversized + decodable). */
  image: ImageInput;
  /** Camera EXIF read from the *original*, to survive the downscale's EXIF strip. */
  imageMetadata?: ImageMetadataInput;
}

/**
 * Result of {@link downscaleForUpload}: the dimensions of the image that will
 * actually be uploaded, plus the re-encoded blob when a downscale happened
 * (`blob` unset = upload the original, whose decoded size is `width`×`height`).
 */
interface DownscaleResult {
  blob?: Blob;
  width: number;
  height: number;
}

/**
 * Prepare an image for upload: read the original's camera EXIF (focal length +
 * dimensions) and, in a browser, downscale it before upload. The server keeps
 * only a low-resolution image, so a high-megapixel camera-roll photo otherwise
 * costs extra server-side decode and bandwidth for pixels that are thrown away.
 *
 * Because a downscale re-encodes (stripping embedded EXIF), the focal fields
 * are read from the original *first* and returned as {@link imageMetadata} so
 * the server can still estimate focal length correctly. The metadata also
 * carries the dimensions of the bytes actually uploaded — the server expresses
 * the resolved focal length at that resolution, so after a downscale the focal
 * would otherwise be wrong by the resize ratio.
 *
 * Falls back to the original image (no downscale) when there's no DOM (Node) or
 * the browser can't decode the format (e.g. HEIC on Chrome) — in which case the
 * embedded EXIF rides along untouched.
 */
export async function prepareImageForUpload(
  image: ImageInput,
  override?: ImageMetadataInput,
  signal?: AbortSignal,
): Promise<PreparedUpload> {
  signal?.throwIfAborted();
  assertImageByteSize(imageInputByteSize(image));
  const original = imageInputToBlob(image);
  const dimensions = await inspectImageHeader(original, signal);
  let filename: string | undefined;
  if (image.type === "file") {
    filename = image.file.name;
  }
  const imageMetadata = override ?? (await readCameraMetadata(original, signal));
  // Unknown or incomplete headers go to the isolated server decoder, not a
  // client pixel decoder whose allocation could precede dimension checks.
  let downscaled: DownscaleResult | undefined;
  if (dimensions) {
    downscaled = await downscaleForUpload(original, filename, signal);
  }
  signal?.throwIfAborted();
  // The decoded upload dims are authoritative whenever we could decode — they
  // describe the bytes we actually send, overriding any caller-supplied value.
  // Undecodable (Node / unknown format) keeps the caller's fields untouched.
  const enriched =
    imageMetadata && downscaled
      ? { ...imageMetadata, uploadedWidth: downscaled.width, uploadedHeight: downscaled.height }
      : imageMetadata;
  return {
    image: downscaled?.blob ? { type: "blob", blob: downscaled.blob } : image,
    ...(enriched && { imageMetadata: enriched }),
  };
}

/** View an {@link ImageInput} as a `Blob` (no copy for blob/file). */
function imageInputToBlob(image: ImageInput): Blob {
  if (image.type === "blob") {
    return image.blob;
  }
  if (image.type === "file") {
    return image.file;
  }
  // `ArrayBuffer` is a `BlobPart` as-is. A `Uint8Array<ArrayBufferLike>` is not
  // (its buffer could be a `SharedArrayBuffer` under the current lib types), so
  // copy it into a fresh `ArrayBuffer`-backed view, which is well-typed.
  const part = image.data instanceof Uint8Array ? new Uint8Array(image.data) : image.data;
  return new Blob([part], { type: image.mimeType });
}

/**
 * Downscale `blob` to {@link MAX_UPLOAD_LONG_EDGE} as a JPEG. Returns the
 * uploaded dimensions in every case the image could be decoded — with the
 * re-encoded blob when a downscale happened, without one when the original is
 * uploaded as-is (already small enough, or the re-encode failed). Returns
 * `undefined` when not in a DOM browser or the format can't be decoded here
 * (caller uploads the original with unknown dimensions).
 */
async function downscaleForUpload(
  blob: Blob,
  filename?: string,
  signal?: AbortSignal,
): Promise<DownscaleResult | undefined> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return; // no DOM (Node / worker) — upload the original
  }
  signal?.throwIfAborted();
  const bitmap = await decodeBitmap(blob, filename, signal);
  if (!bitmap) {
    return;
  }
  try {
    signal?.throwIfAborted();
    assertImageDimensions(bitmap.width, bitmap.height);
    let out: DownscaleResult = { width: bitmap.width, height: bitmap.height };
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > MAX_UPLOAD_LONG_EDGE) {
      const scale = MAX_UPLOAD_LONG_EDGE / longest;
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const encoded = await encodeDownscaledJpeg(bitmap, width, height);
      signal?.throwIfAborted();
      if (encoded) {
        assertImageByteSize(encoded.size);
        out = { blob: encoded, width, height };
      }
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/**
 * Decode `blob` to an `ImageBitmap`, applying EXIF orientation. Falls back to
 * the shared HEIC→JPEG converter when the browser can't decode the format
 * natively (e.g. HEIC on Chrome). Returns `undefined` if it can't be decoded.
 */
async function decodeBitmap(
  blob: Blob,
  filename?: string,
  signal?: AbortSignal,
): Promise<ImageBitmap | undefined> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // Not natively decodable — try the HEIC fallback below.
  }
  signal?.throwIfAborted();
  const jpeg = await convertHeicToJpeg(blob, filename, signal);
  let bitmap: ImageBitmap | undefined;
  if (jpeg) {
    try {
      bitmap = await createImageBitmap(jpeg, { imageOrientation: "from-image" });
    } catch {
      // Decode of the converted JPEG failed — give up; caller uploads original.
    }
  }
  return bitmap;
}

/** Draw `bitmap` at `width`×`height` to a canvas and encode it as a JPEG `Blob`. */
async function encodeDownscaledJpeg(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  let out: Blob | undefined;
  if (ctx) {
    ctx.drawImage(bitmap, 0, 0, width, height);
    // oxlint-disable-next-line eslint-plugin-promise/avoid-new -- canvas.toBlob is a callback API; promisifying is the only way to await it.
    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => {
          resolve(b);
        },
        "image/jpeg",
        UPLOAD_JPEG_QUALITY,
      );
    });
    if (encoded) {
      out = encoded;
    }
  }
  return out;
}
