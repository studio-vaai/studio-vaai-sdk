import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import { prepareImageForUpload } from "../../src/experience/browser/photo/prepare-upload.js";
import { initializeTestUi } from "../ui-fixture.js";
import { jpegBytes } from "./helpers/image-fixtures.js";

/** Header-only JPEG; actual pixel decoding is stubbed. */
function bytesImage(width = 5712, height = 4284) {
  return {
    type: "bytes" as const,
    data: jpegBytes(width, height),
    mimeType: "image/jpeg",
  };
}

/** Camera metadata as a caller supplies it, for a 5712×4284 original. */
const cameraMetadata = { originalWidth: 5712, originalHeight: 4284, focalLength35mm: 24 };

describe("prepareImageForUpload", () => {
  beforeAll(initializeTestUi);

  it("prefers a caller-provided imageMetadata override", async () => {
    const image = bytesImage(2000, 1500);
    const override = { originalWidth: 1, originalHeight: 2, focalLength35mm: 50 };
    const prepared = await prepareImageForUpload(image, override);
    // vitest runs in Node: no createImageBitmap/document, so the original is uploaded.
    expect(prepared.image).toBe(image);
    expect(prepared.imageMetadata).toBe(override);
  });
});

/**
 * Stub the browser decode/canvas globals so the downscale path runs in Node:
 * `createImageBitmap` yields a fake bitmap of the given size, and the canvas
 * `toBlob` re-encode emits a tiny placeholder JPEG blob.
 */
function stubDomDownscale(bitmapWidth: number, bitmapHeight: number) {
  vi.stubGlobal("createImageBitmap", async () => ({
    width: bitmapWidth,
    height: bitmapHeight,
    close: vi.fn<() => void>(),
  }));
  const toBlob = vi.fn<
    (onEncoded: (blob: Blob | null) => void, type: string, quality: number) => void
  >((onEncoded) => {
    onEncoded(new Blob([new Uint8Array(8)], { type: "image/jpeg" }));
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn<() => void>() }),
      toBlob,
    }),
  });
  return toBlob;
}

describe("prepareImageForUpload (browser downscale)", () => {
  beforeAll(initializeTestUi);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the downscaled upload dimensions to the camera metadata", async () => {
    // Long edge 5712 > 2600 cap → downscale to 2600x1950.
    const encode = stubDomDownscale(5712, 4284);
    const prepared = await prepareImageForUpload(bytesImage(), cameraMetadata);
    expect(prepared.image.type).toBe("blob");
    expect(encode).toHaveBeenCalledExactlyOnceWith(expect.any(Function), "image/jpeg", 0.9);
    expect(prepared.imageMetadata?.originalWidth).toBe(5712);
    expect(prepared.imageMetadata?.originalHeight).toBe(4284);
    expect(prepared.imageMetadata?.uploadedWidth).toBe(2600);
    expect(prepared.imageMetadata?.uploadedHeight).toBe(1950);
  });

  it("reports the decoded dimensions when no downscale is needed", async () => {
    stubDomDownscale(2000, 1500);
    const image = bytesImage();
    const prepared = await prepareImageForUpload(image, cameraMetadata);
    // Already under the cap: the original bytes are uploaded unchanged...
    expect(prepared.image).toBe(image);
    // ...and the decoded dims still ride along (they describe the upload).
    expect(prepared.imageMetadata?.uploadedWidth).toBe(2000);
    expect(prepared.imageMetadata?.uploadedHeight).toBe(1500);
  });

  it("overrides caller-supplied uploaded dims with the actual upload's", async () => {
    stubDomDownscale(5712, 4284);
    const override = {
      ...cameraMetadata,
      focalLength35mm: 50,
      uploadedWidth: 99,
      uploadedHeight: 88,
    };
    const prepared = await prepareImageForUpload(bytesImage(), override);
    // The built-in downscale decides what is uploaded, so its dims win.
    expect(prepared.imageMetadata?.uploadedWidth).toBe(2600);
    expect(prepared.imageMetadata?.uploadedHeight).toBe(1950);
    expect(prepared.imageMetadata?.focalLength35mm).toBe(50);
  });
});
