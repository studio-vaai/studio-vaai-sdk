import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import type { FormattedMessage } from "../src/index.js";

import { canonicalizeLocale, createMessageFormatter, initializeCore } from "../src/index.js";

function text(message: FormattedMessage | undefined): string {
  expect(message?.errors).toEqual([]);
  return (
    message?.parts
      .map((part) => {
        if (part.type === "bidiIsolation") {
          return "";
        }
        if ("value" in part) {
          return part.value;
        }
        if (part.type === "number") {
          return part.parts.map((part) => part.value).join("");
        }
        return "";
      })
      .join("") ?? ""
  );
}

describe("caller-supplied locale policy", () => {
  beforeAll(async () => {
    await initializeCore(
      new Uint8Array(await readFile(new URL("../dist/studio_vaai_core.wasm", import.meta.url))),
    );
  });

  it("normalizes caller tags before initialization and defaults invalid tags to English", () => {
    expect(canonicalizeLocale("de_ch")).toBe("de-CH");
    expect(canonicalizeLocale("not a locale!")).toBe("en");
    const formatter = createMessageFormatter("not a locale!");
    expect(formatter.locale).toBe("en");
    formatter.dispose();
  });

  it("uses regional CLDR rules for caller messages while keeping shipped text language", () => {
    const formatter = createMessageFormatter("de_CH", {
      number: "{$value :number}",
      percent: "{$value :percent}",
    });
    expect(formatter.locale).toBe("de-CH");
    expect(formatter.catalogLocale).toBe("de");
    expect(text(formatter.format("number", { value: 1234.5 }))).toBe("1'234.5");
    expect(text(formatter.format("sessionIntro.sheetTitle"))).toBe("Bereit zur Anprobe?");
    formatter.dispose();
    const german = createMessageFormatter("de", { percent: "{$value :percent}" });
    expect(text(german.format("percent", { value: 0.5 }))).toBe("50\u00A0%");
    german.dispose();
    const british = createMessageFormatter("en-GB", { list: "{$values :list}" });
    expect(text(british.format("list", { values: ["A", "B", "C"] }))).toBe("A, B and C");
    british.dispose();
  });

  it("uses requested formatting for any caller catalog and English without one", () => {
    const noCatalog = createMessageFormatter("fr-CA");
    expect(noCatalog.locale).toBe("en");
    noCatalog.dispose();
    const emptyCatalog = createMessageFormatter("fr-CA", {});
    expect(emptyCatalog.locale).toBe("fr-CA");
    expect(emptyCatalog.catalogLocale).toBe("en");
    expect(text(emptyCatalog.format("sessionIntro.sheetTitle"))).toBe("Ready to try it on?");
    emptyCatalog.dispose();
    const partial = createMessageFormatter("fr-CA", { list: "{$values :list}" });
    expect(text(partial.format("list", { values: ["A", "B", "C"] }))).toBe("A, B et C");
    expect(text(partial.format("sessionIntro.sheetTitle"))).toBe("Ready to try it on?");
    partial.dispose();
  });
});
