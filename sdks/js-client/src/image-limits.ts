/* oxlint-disable eslint/no-bitwise -- Image container fields have bit-packed dimensions and flags. */
import type { ImageInput } from "./api/body.js";

/** Input budgets apply before reading, metadata parsing or local pixel decoding. */
export const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;
const MAX_IMAGE_EDGE = 16_384;
const MAX_IMAGE_PIXELS = 64_000_000;

export class ImageInputError extends Error {
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

export interface HeaderDimensions {
  width: number;
  height: number;
}

export function assertImageByteSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_INPUT_BYTES) {
    throw new ImageInputError("Photo must contain between 1 byte and 50 MiB.");
  }
}

export function assertImageDimensions(width: number, height: number): HeaderDimensions {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_EDGE ||
    height > MAX_IMAGE_EDGE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new ImageInputError("Photo dimensions exceed the processing limit.");
  }
  return { width, height };
}

/** Unknown/incomplete headers skip local decoding; the server validates original bytes. */
export async function inspectImageHeader(
  blob: Blob,
  signal?: AbortSignal,
): Promise<HeaderDimensions | undefined> {
  assertImageByteSize(blob.size);
  signal?.throwIfAborted();
  const sniff = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  signal?.throwIfAborted();
  if (sniff.length >= 16 && fourcc(sniff, 4) === "ftyp") {
    return await inspectHeifContainer(blob, signal);
  }
  const prefix = await blob.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer();
  signal?.throwIfAborted();
  return readImageHeader(new Uint8Array(prefix));
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCodePoint(...bytes.subarray(offset, offset + 4));
}

function readImageHeader(bytes: Uint8Array): HeaderDimensions | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && bytes[0] === 137 && fourcc(bytes, 1) === "PNG\r") {
    let dimensions: HeaderDimensions | undefined;
    for (let offset = 8; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset);
      const type = fourcc(bytes, offset + 4);
      if (type === "IDAT" || type === "IEND") {
        return dimensions;
      }
      if (offset + 12 + length > bytes.length) {
        return;
      }
      if (type === "IHDR" && length === 13) {
        dimensions = assertImageDimensions(view.getUint32(offset + 8), view.getUint32(offset + 12));
      }
      if (type === "acTL" && length >= 8 && view.getUint32(offset + 8) !== 1) {
        throw new ImageInputError("Only still photos are supported.");
      }
      offset += length + 12;
    }
    return;
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let dimensions: HeaderDimensions | undefined;
    for (let offset = 2; offset + 1 < bytes.length;) {
      if (bytes[offset] !== 255) {
        return;
      }
      const marker = bytes[offset + 1];
      if (marker === 255) {
        offset += 1;
        continue;
      }
      if (marker === 218 || marker === 217) {
        return dimensions;
      }
      if (marker === 1 || (typeof marker === "number" && marker >= 208 && marker <= 215)) {
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) {
        return;
      }
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) {
        return;
      }
      if (
        typeof marker === "number" &&
        marker >= 192 &&
        marker <= 207 &&
        ![196, 200, 204].includes(marker)
      ) {
        if (length < 8 || dimensions) {
          return;
        }
        dimensions = assertImageDimensions(view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      offset += length + 2;
    }
    return;
  }
  if (bytes.length >= 12 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP") {
    let dimensions: HeaderDimensions | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = fourcc(bytes, offset);
      const length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + Math.min(length, 10) > bytes.length) {
        return;
      }
      if (type === "ANIM" || (type === "VP8X" && (bytes[start] ?? 0) & 2)) {
        throw new ImageInputError("Only still photos are supported.");
      }
      if (type === "VP8X" && length >= 10) {
        const width = 1 + (view.getUint32(start + 4, true) & 16_777_215);
        const height = 1 + (view.getUint32(start + 6, true) >>> 8);
        dimensions = assertImageDimensions(width, height);
      }
      if (
        type === "VP8 " &&
        length >= 10 &&
        bytes[start + 3] === 157 &&
        bytes[start + 4] === 1 &&
        bytes[start + 5] === 42
      ) {
        const frame = assertImageDimensions(
          view.getUint16(start + 6, true) & 16_383,
          view.getUint16(start + 8, true) & 16_383,
        );
        return dimensions ?? frame;
      }
      if (type === "VP8L" && length >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        const frame = assertImageDimensions((bits & 16_383) + 1, ((bits >>> 14) & 16_383) + 1);
        return dimensions ?? frame;
      }
      offset = start + length + (length % 2);
    }
    return;
  }
  // oxlint-disable-next-line eslint/no-useless-return -- Explicit optional return is required by noImplicitReturns.
  return;
}

/** Read only bounded metadata and top-level headers, including after media data. */
// oxlint-disable no-await-in-loop -- Each admitted box determines the next offset and bounded read.
async function inspectHeifContainer(
  blob: Blob,
  signal?: AbortSignal,
): Promise<HeaderDimensions | undefined> {
  let offset = 0;
  let visited = 0;
  let metadataBytes = 0;
  let inspectedBytes = 16; // The initial format probe is part of the read budget.
  let fileType: Uint8Array | undefined;
  let metadata: Uint8Array | undefined;
  while (offset < blob.size) {
    visited += 1;
    if (visited > 4096) {
      return;
    }
    signal?.throwIfAborted();
    const headerBytes = Math.min(16, blob.size - offset);
    if (headerBytes > MAX_IMAGE_HEADER_BYTES - inspectedBytes) {
      return;
    }
    const bytes = new Uint8Array(
      await blob.slice(offset, Math.min(offset + 16, blob.size)).arrayBuffer(),
    );
    inspectedBytes += bytes.length;
    signal?.throwIfAborted();
    if (bytes.length < 8) {
      return;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = fourcc(bytes, 4);
    let length = view.getUint32(0);
    let header = 8;
    if (length === 1) {
      if (bytes.length < 16) {
        return;
      }
      length = Number(view.getBigUint64(8));
      header = 16;
    } else if (length === 0) {
      length = blob.size - offset;
    }
    if (!Number.isSafeInteger(length) || length < header || length > blob.size - offset) {
      return;
    }
    if (offset === 0 && type !== "ftyp") {
      return;
    }
    if (type === "ftyp" || type === "meta") {
      if (
        (type === "ftyp" && (offset !== 0 || fileType || length > 4096 || length < header + 8)) ||
        (type === "meta" && metadata) ||
        length > MAX_IMAGE_HEADER_BYTES - inspectedBytes
      ) {
        return;
      }
      const contents = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
      signal?.throwIfAborted();
      if (contents.length !== length) {
        return;
      }
      metadataBytes += contents.length;
      inspectedBytes += contents.length;
      if (type === "ftyp") {
        fileType = contents;
      } else {
        metadata = contents;
      }
    } else if (!["mdat", "free", "skip", "wide"].includes(type)) {
      // Movie/unknown top-level containers are not admitted to a local decoder.
      return;
    }
    offset += length;
  }
  if (fileType && metadata) {
    const compact = new Uint8Array(metadataBytes);
    compact.set(fileType);
    compact.set(metadata, fileType.length);
    return readHeifHeader(compact, visited);
  }
  // oxlint-disable-next-line eslint/no-useless-return -- Explicit optional return is required by noImplicitReturns.
  return;
}
// oxlint-enable no-await-in-loop

function readHeifHeader(bytes: Uint8Array, initialBoxes: number): HeaderDimensions | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dimensions: HeaderDimensions | undefined;
  let visited = initialBoxes;
  let completeMetadata = false;
  function boxes(start: number, end: number, depth: number): boolean {
    if (depth > 8) {
      return false;
    }
    for (let offset = start; offset < end;) {
      visited += 1;
      if (visited > 4096 || offset + 8 > bytes.length) {
        return false;
      }
      let length = view.getUint32(offset);
      let header = 8;
      const type = fourcc(bytes, offset + 4);
      if (length === 1) {
        if (offset + 16 > bytes.length) {
          return false;
        }
        length = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (length === 0) {
        length = end - offset;
      }
      if (!Number.isSafeInteger(length) || length < header || length > end - offset) {
        return false;
      }
      const payload = offset + header;
      const next = offset + length;
      if (type === "mdat") {
        return false;
      }
      if (next > bytes.length) {
        return false;
      }
      if (type === "ftyp") {
        for (let brand = payload; brand + 4 <= next; brand += 4) {
          if (["msf1", "hevc", "hevx", "avis"].includes(fourcc(bytes, brand))) {
            return false;
          }
        }
      } else if (type === "meta") {
        if (
          depth !== 0 ||
          completeMetadata ||
          payload + 4 > next ||
          bytes[payload] !== 0 ||
          !boxes(payload + 4, next, depth + 1)
        ) {
          return false;
        }
        completeMetadata = true;
      } else if (type === "iprp" || type === "ipco") {
        if (!boxes(payload, next, depth + 1)) {
          return false;
        }
      } else if (type === "ispe") {
        if (payload + 12 > next) {
          return false;
        }
        const candidate = assertImageDimensions(
          view.getUint32(payload + 4),
          view.getUint32(payload + 8),
        );
        if (
          !dimensions ||
          candidate.width * candidate.height > dimensions.width * dimensions.height
        ) {
          dimensions = candidate;
        }
      } else if (type === "iinf") {
        if (payload + 8 > next) {
          return false;
        }
        const count =
          bytes[payload] === 0 ? view.getUint16(payload + 4) : view.getUint32(payload + 4);
        if (count > 256) {
          throw new ImageInputError("Photo contains too many image items.");
        }
      } else if (type === "moov") {
        return false;
      }
      offset = next;
    }
    return true;
  }
  if (boxes(0, bytes.length, 0) && completeMetadata) {
    return dimensions;
  }
  // oxlint-disable-next-line eslint/no-useless-return -- Explicit optional return is required by noImplicitReturns.
  return;
}
