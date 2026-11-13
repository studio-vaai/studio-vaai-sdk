import type { ImageInput } from "../api/body.js";

import { assertImageByteSize, imageInputByteSize } from "../image-limits.js";

interface NormalizedImageBytes {
  data: Uint8Array;
  mimeType: string;
}

export async function imageInputToBytes(
  image: ImageInput,
  signal?: AbortSignal,
): Promise<NormalizedImageBytes> {
  signal?.throwIfAborted();
  assertImageByteSize(imageInputByteSize(image));
  if (image.type === "blob") {
    const buf = await image.blob.arrayBuffer();
    signal?.throwIfAborted();
    const mimeType = image.blob.type || "application/octet-stream";
    return { data: new Uint8Array(buf), mimeType };
  }
  if (image.type === "file") {
    const buf = await image.file.arrayBuffer();
    signal?.throwIfAborted();
    const mimeType = image.file.type || "application/octet-stream";
    return { data: new Uint8Array(buf), mimeType };
  }
  if (image.type === "bytes") {
    const raw = image.data;
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    return { data, mimeType: image.mimeType };
  }
  const _never: never = image;
  throw new Error(`unsupported image input: ${String(_never)}`);
}
