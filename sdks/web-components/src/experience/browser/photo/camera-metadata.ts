import { initializeCore, photoInputLimits, readImageMetadata } from "@studio-vaai/core";

import type { ImageMetadataInput } from "./types.js";

import { assertImageByteSize } from "./image-limits.js";

/** Preserve the original camera metadata across browser re-encoding. */
export async function readCameraMetadata(
  original: Blob,
  signal?: AbortSignal,
): Promise<ImageMetadataInput | undefined> {
  signal?.throwIfAborted();
  await initializeCore();
  assertImageByteSize(original.size);
  signal?.throwIfAborted();
  const bytes = await original.slice(0, photoInputLimits().headerBytes).arrayBuffer();
  signal?.throwIfAborted();
  const metadata = readImageMetadata(bytes);
  if (metadata === undefined) {
    return undefined;
  }
  const {
    originalWidth,
    originalHeight,
    focalLengthMm,
    focalLength35mm,
    focalPlaneXResolution,
    focalPlaneYResolution,
    focalPlaneResolutionUnit,
  } = metadata;
  return {
    originalWidth,
    originalHeight,
    ...(focalLengthMm === undefined ? {} : { focalLengthMm }),
    ...(focalLength35mm === undefined ? {} : { focalLength35mm }),
    ...(focalPlaneXResolution === undefined ? {} : { focalPlaneXResolution }),
    ...(focalPlaneYResolution === undefined ? {} : { focalPlaneYResolution }),
    ...(focalPlaneResolutionUnit === undefined ? {} : { focalPlaneResolutionUnit }),
  };
}
