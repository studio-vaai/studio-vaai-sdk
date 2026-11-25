import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { displayablePhoto, hasTransparency } from "../src/experience/api/displayable-photo.js";
import { initializeTestUi } from "./ui-fixture.js";

/** A lossless 4 × 3 JPEG XL gradient, as the core's decoder test has it. */
const GRADIENT = Uint8Array.from(
  atob("/woQMBAJCAQBAMAASxiTjoODhBNUJ4ow7vcCwQAIDw+/s/Dw8DsLDw/X3d39I32n+yBxkAAwMw8z8zAz"),
  (c) => c.codePointAt(0) ?? 0,
);
const PHOTO = "https://storage.example.test/source-images/photo.jxl?signature=1";

function serving(response: () => Response) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe(PHOTO);
    expect(request.credentials).toBe("omit");
    expect(request.mode).toBe("cors");
    return await Promise.resolve(response());
  });
}

describe("displayable restored photo", () => {
  beforeAll(async () => {
    await initializeTestUi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the signed photo over CORS and shows it from a same-origin blob", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      async () => await Promise.resolve({ close: vi.fn<() => void>() }),
    );
    const fetch = serving(() => new Response(new Blob([GRADIENT], { type: "image/jxl" })));
    const src = await displayablePhoto(PHOTO, fetch, new AbortController().signal);
    expect(src).toMatch(/^blob:/u);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("decodes JPEG XL with the core where the browser cannot", async () => {
    vi.stubGlobal("createImageBitmap", async () => await Promise.reject(new Error("unsupported")));
    const drawn: { width: number; height: number; pixels: number }[] = [];
    const types: string[] = [];
    // Node has no canvas: just enough of one to see what the page would draw.
    vi.stubGlobal(
      "ImageData",
      vi.fn(function pixels(data: Uint8ClampedArray, width: number, height: number) {
        return { data, width, height };
      }),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      vi.fn(function canvas() {
        return {
          getContext: () => ({
            putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) => {
              drawn.push({ width: image.width, height: image.height, pixels: image.data.length });
            },
          }),
          convertToBlob: async (options: { type: string }) => {
            types.push(options.type);
            return await Promise.resolve(new Blob(["jpeg"], options));
          },
        };
      }),
    );
    const src = await displayablePhoto(
      PHOTO,
      serving(() => new Response(new Blob([GRADIENT], { type: "image/jxl" }))),
      new AbortController().signal,
    );
    expect(src).toMatch(/^blob:/u);
    expect(drawn).toEqual([{ width: 4, height: 3, pixels: 4 * 3 * 4 }]);
    // An opaque photo stays a JPEG.
    expect(types).toEqual(["image/jpeg"]);
  });

  it("keeps a cut-out's transparency", () => {
    expect(hasTransparency([10, 20, 30, 255, 40, 50, 60, 255])).toBe(false);
    expect(hasTransparency([10, 20, 30, 255, 0, 0, 0, 0])).toBe(true);
    expect(hasTransparency([10, 20, 30, 128])).toBe(true);
  });

  it("keeps the signed URL when the photo cannot be read", async () => {
    const src = await displayablePhoto(
      PHOTO,
      serving(() => new Response("<Error/>", { status: 403 })),
      new AbortController().signal,
    );
    expect(src).toBe(PHOTO);
  });
});
