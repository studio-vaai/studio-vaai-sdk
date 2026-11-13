import { afterEach, describe, expect, it, vi } from "vitest";

import { readCameraMetadata } from "../src/camera-metadata.js";
import {
  inspectImageHeader,
  MAX_IMAGE_HEADER_BYTES,
  MAX_IMAGE_INPUT_BYTES,
} from "../src/image-limits.js";
import { prepareImageForUpload } from "../src/impl/prepare-upload.js";
import { createFetchStudioVaaiClient, type SessionHandle } from "../src/index.js";
import { jpeg, heif } from "./helpers/image-fixtures.js";

function containerBox(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 8);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(payload, 8);
  return bytes;
}
async function heifLayout(afterMedia: boolean, trailing?: "meta" | "moov" | "ftyp") {
  const bytes = new Uint8Array(await heif().arrayBuffer());
  const view = new DataView(bytes.buffer);
  const fileTypeLength = view.getUint32(0);
  const metaLength = view.getUint32(fileTypeLength);
  const fileType = bytes.slice(0, fileTypeLength);
  const metadata = bytes.slice(fileTypeLength, fileTypeLength + metaLength);
  const media = containerBox("mdat", new Uint8Array(3 * MAX_IMAGE_HEADER_BYTES));
  const parts = afterMedia ? [fileType, media, metadata] : [fileType, metadata, media];
  const mediaStart = afterMedia ? fileType.length : fileType.length + metadata.length;
  if (trailing === "meta") {
    parts.push(metadata);
  } else if (trailing === "moov") {
    parts.push(containerBox("moov", new Uint8Array()));
  } else if (trailing === "ftyp") {
    parts.push(fileType);
  }
  return {
    blob: new Blob(parts, { type: "image/heic" }),
    mediaStart,
    mediaEnd: mediaStart + media.length,
  };
}

describe("photo input admission", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects compressed large dimensions before pixel decoding or trusting metadata overrides", async () => {
    const decode = vi.fn<() => void>();
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("document", {});
    await expect(
      prepareImageForUpload(
        { type: "blob", blob: jpeg(16_385, 1) },
        { originalWidth: 1, originalHeight: 1 },
      ),
    ).rejects.toThrow("dimensions");
    expect(decode).not.toHaveBeenCalled();
    await expect(inspectImageHeader(heif(16_384, 16_384))).rejects.toThrow("dimensions");
  });

  it("accepts a 48MP photo and reads complete HEIF dimension properties", async () => {
    await expect(inspectImageHeader(jpeg(8064, 6048))).resolves.toEqual({
      width: 8064,
      height: 6048,
    });
    await expect(inspectImageHeader(heif())).resolves.toEqual({ width: 4032, height: 3024 });
  });

  for (const afterMedia of [false, true]) {
    it(`checks complete HEIF metadata without reading large media data (metadata after media: ${String(afterMedia)})`, async () => {
      const { blob, mediaStart, mediaEnd } = await heifLayout(afterMedia);
      const slices = vi.spyOn(blob, "slice");
      await expect(inspectImageHeader(blob)).resolves.toEqual({ width: 4032, height: 3024 });
      for (const [start = 0, end = blob.size] of slices.mock.calls) {
        expect(end - start).toBeLessThanOrEqual(MAX_IMAGE_HEADER_BYTES);
        expect(start < mediaEnd && end > mediaStart + 16).toBe(false);
      }
      expect(
        slices.mock.calls.reduce((total, [start = 0, end = blob.size]) => total + end - start, 0),
      ).toBeLessThanOrEqual(MAX_IMAGE_HEADER_BYTES);
      expect(slices.mock.calls.length).toBeLessThanOrEqual(8);
    });
  }
  for (const trailing of ["meta", "moov", "ftyp"] as const) {
    it(`rejects a trailing ${trailing} after large HEIF media before local decode`, async () => {
      const { blob } = await heifLayout(false, trailing);
      const decode = vi.fn<() => void>();
      vi.stubGlobal("createImageBitmap", decode);
      vi.stubGlobal("document", {});
      await expect(inspectImageHeader(blob)).resolves.toBeUndefined();
      await expect(prepareImageForUpload({ type: "blob", blob })).resolves.toMatchObject({
        image: { blob },
      });
      expect(decode).not.toHaveBeenCalled();
    });
  }

  it("skips local decoding when headers are unknown or incomplete", async () => {
    const decode = vi.fn<() => void>();
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("document", {});
    const blob = new Blob([new Uint8Array([255, 216, 255, 192, 255, 255])], { type: "image/jpeg" });
    const result = await prepareImageForUpload({ type: "blob", blob });
    expect(result.image).toEqual({ type: "blob", blob });
    expect(decode).not.toHaveBeenCalled();
  });

  it("checks file size before metadata I/O and returns a typed API failure without network calls", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    Object.defineProperty(blob, "size", { value: MAX_IMAGE_INPUT_BYTES + 1 });
    const read = vi.spyOn(blob, "arrayBuffer");
    const slice = vi.spyOn(blob, "slice");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createFetchStudioVaaiClient({
      baseUrl: "https://api.test",
      clientApiKey: "shop",
      sessionTransport: "bearer",
      fetch,
    });
    await expect(
      client.body.createBody({
        session: "session" as SessionHandle,
        image: { type: "blob", blob },
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: "validation_error" } });
    expect(read).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caps metadata reads and omits unreadable trailing fields", async () => {
    const blob = new Blob([new Uint8Array(MAX_IMAGE_HEADER_BYTES + 100)]);
    const slice = vi.spyOn(blob, "slice");
    await expect(readCameraMetadata(blob)).resolves.toBeUndefined();
    expect(slice).toHaveBeenCalledWith(0, MAX_IMAGE_HEADER_BYTES);
  });

  it("closes a decoded bitmap even when the returned dimensions violate its header", async () => {
    const close = vi.fn<() => void>();
    vi.stubGlobal("createImageBitmap", async () => ({ width: 32_768, height: 1, close }));
    vi.stubGlobal("document", {});
    await expect(prepareImageForUpload({ type: "blob", blob: jpeg(100, 100) })).rejects.toThrow(
      "dimensions",
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
