// @vitest-environment node
import { describe, expect, it } from "vitest";

import { downloadFilename } from "../src/batteries/try-on-view-screen.js";

describe("try-on download filename", () => {
  it("names the file after the garment and the size", () => {
    expect(downloadFilename("Rana Striped Longsleeve", "m")).toBe("rana-striped-longsleeve-m.jpg");
  });

  it("folds accents and collapses punctuation into single hyphens", () => {
    expect(downloadFilename("Größe & Passform!!", "xl")).toBe("grosse-passform-xl.jpg");
    expect(downloadFilename("Ont ≠ Kop 11", "s")).toBe("ont-kop-11-s.jpg");
  });

  it("lowercases the size so 2XL and 2xl produce one filename", () => {
    expect(downloadFilename("Harry Pants", "2XL")).toBe("harry-pants-2xl.jpg");
  });

  it("drops the size segment when there is none", () => {
    expect(downloadFilename("Harry Pants", "")).toBe("harry-pants.jpg");
  });

  it("falls back to a generic name when the garment slugifies to nothing", () => {
    expect(downloadFilename("—", "m")).toBe("studio-vaai-try-on-m.jpg");
  });
});
