// Namespace import: `exifreader` ships a UMD/CommonJS `main` with no `exports`
// map and no default export in its types, so a *named* import (`{ load }`)
// can't be statically resolved by strict ESM loaders (Vite's SSR module-runner
// errors on it) and a *default* import doesn't typecheck. A namespace import is
// the one form that both typechecks and is CJS-interop-safe at runtime.
// eslint-disable-next-line import/no-namespace -- required for the CJS exifreader module; see above.
import * as ExifReader from "exifreader";

import type { ImageMetadataInput } from "./api/body.js";

import { assertImageByteSize, MAX_IMAGE_HEADER_BYTES } from "./image-limits.js";

/**
 * Read {@link ImageMetadataInput} from an *original* image, for use with
 * {@link CreateBodyArgs.imageMetadata} when you downscale before upload.
 *
 * Parses the EXIF focal-length fields + original dimensions with `exifreader`
 * (JPEG, TIFF, PNG, HEIC, AVIF, WebP). Returns `undefined` if the dimensions
 * can't be read; any focal field the image lacks is simply omitted and the
 * server falls back accordingly.
 *
 * Pass the result alongside the resized image, adding the resized dimensions
 * (the server expresses the focal length at the *uploaded* resolution):
 * ```ts
 * const imageMetadata = await readCameraMetadata(originalFile);
 * await client.body.createBody({
 *   session,
 *   image: { type: "blob", blob: resized },
 *   imageMetadata: imageMetadata && {
 *     ...imageMetadata,
 *     uploadedWidth: resizedWidth,
 *     uploadedHeight: resizedHeight,
 *   },
 * });
 * ```
 */
export async function readCameraMetadata(
  original: Blob,
  signal?: AbortSignal,
): Promise<ImageMetadataInput | undefined> {
  assertImageByteSize(original.size);
  signal?.throwIfAborted();
  // Late or oversized metadata is optional, never a reason to buffer the photo.
  const buf = await original.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer();
  signal?.throwIfAborted();

  let tags;
  try {
    tags = ExifReader.load(buf);
  } catch {
    return; // unreadable / no metadata
  }

  const originalWidth =
    tagNumber(tags["Image Width"]) ?? tagNumber(tags.PixelXDimension) ?? tagNumber(tags.ImageWidth);
  const originalHeight =
    tagNumber(tags["Image Height"]) ??
    tagNumber(tags.PixelYDimension) ??
    tagNumber(tags.ImageLength);
  if (typeof originalWidth !== "number" || typeof originalHeight !== "number") {
    return;
  }

  const focalLengthMm = tagNumber(tags.FocalLength);
  const focalLength35mm = tagNumber(tags.FocalLengthIn35mmFilm);
  const focalPlaneXResolution = tagNumber(tags.FocalPlaneXResolution);
  const focalPlaneYResolution = tagNumber(tags.FocalPlaneYResolution);
  const focalPlaneResolutionUnit = tagNumber(tags.FocalPlaneResolutionUnit);

  return {
    originalWidth,
    originalHeight,
    ...(typeof focalLengthMm === "number" && { focalLengthMm }),
    ...(typeof focalLength35mm === "number" && { focalLength35mm }),
    ...(typeof focalPlaneXResolution === "number" && { focalPlaneXResolution }),
    ...(typeof focalPlaneYResolution === "number" && { focalPlaneYResolution }),
    ...(typeof focalPlaneResolutionUnit === "number" && { focalPlaneResolutionUnit }),
  };
}

/**
 * Coerce an ExifReader tag to a finite number. Handles plain number tags and
 * rational tags (`value: [num, den]`, whose `description` is the pre-divided
 * number).
 */
function tagNumber(tag: unknown): number | undefined {
  let result: number | undefined;
  if (typeof tag === "object" && tag !== null) {
    const { value, description } = tag as { value?: unknown; description?: unknown };
    if (typeof description === "number" && Number.isFinite(description)) {
      result = description;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result = value;
    } else if (Array.isArray(value) && value.length === 2) {
      const [num, den] = value as unknown[];
      if (typeof num === "number" && typeof den === "number" && den !== 0) {
        result = num / den;
      }
    }
  }
  if (typeof result === "number" && Number.isFinite(result)) {
    return result;
  }
  // oxlint-disable-next-line eslint/no-useless-return -- Explicit optional return is required by noImplicitReturns.
  return;
}
