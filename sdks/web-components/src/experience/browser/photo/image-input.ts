import type { ImageInput } from "./types.js";

/** View an {@link ImageInput} as a `Blob` (no copy for blob/file). */
export function imageInputToBlob(image: ImageInput): Blob {
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
