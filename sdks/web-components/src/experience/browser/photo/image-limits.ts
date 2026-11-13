import {
  initializeCore,
  inspectPhotoHeader,
  PhotoHeader,
  PhotoInputRejection,
  photoDimensionsRejection,
  photoSizeRejection,
} from "@studio-vaai/core";

import type { ImageInput } from "./types.js";

const messages = {
  [PhotoInputRejection.ByteSize]: "Photo must contain between 1 byte and 50 MiB.",
  [PhotoInputRejection.Dimensions]: "Photo dimensions exceed the processing limit.",
  [PhotoInputRejection.Animation]: "Only still photos are supported.",
  [PhotoInputRejection.TooManyItems]: "Photo contains too many image items.",
};

class ImageInputError extends Error {
  override name = "ImageInputError";
}

export function imageInputByteSize(image: ImageInput): number {
  if (image.type === "bytes") {
    return image.data.byteLength;
  }
  if (image.type === "blob") {
    return image.blob.size;
  }
  return image.file.size;
}

function unsigned32(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 4_294_967_295 ? value : 0;
}

export function assertImageByteSize(size: number): void {
  const reason = photoSizeRejection(unsigned32(size));
  if (reason !== undefined) {
    throw new ImageInputError(messages[reason]);
  }
}

export function assertImageDimensions(width: number, height: number): void {
  const reason = photoDimensionsRejection(unsigned32(width), unsigned32(height));
  if (reason !== undefined) {
    throw new ImageInputError(messages[reason]);
  }
}

/** Unknown or incomplete headers leave decoding to the server. */
export async function inspectImageHeader(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ width: number; height: number } | undefined> {
  signal?.throwIfAborted();
  await initializeCore();
  signal?.throwIfAborted();
  const size = unsigned32(blob.size);
  const header = await inspectPhotoHeader(
    size,
    {
      async read(offset, length) {
        if (signal?.aborted === true) {
          return new ArrayBuffer(0);
        }
        return await blob.slice(offset, offset + length).arrayBuffer();
      },
    },
    signal === undefined ? undefined : { signal },
  );
  signal?.throwIfAborted();
  if (PhotoHeader.Rejected.instanceOf(header)) {
    throw new ImageInputError(messages[header.inner.reason]);
  }
  return PhotoHeader.Still.instanceOf(header) ? header.inner : undefined;
}
