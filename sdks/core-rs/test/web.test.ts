import { readFile } from "node:fs/promises";
import { describe, beforeAll, expect, it } from "vitest";

import { availableLocales, createMessageFormatter, initializeCore } from "../src/index.js";

describe("shared SDK UI", () => {
  beforeAll(async () => {
    await initializeCore(
      new Uint8Array(await readFile(new URL("../dist/studio_vaai_core.wasm", import.meta.url))),
    );
  });
  it("exposes the Rust catalog's locales, regional resolution and rich parts", () => {
    expect(availableLocales()).toEqual(["de", "en"]);
    const formatter = createMessageFormatter("de-CH");
    expect(formatter.locale).toBe("de-CH");
    expect(formatter.catalogLocale).toBe("de");
    expect(formatter.format("sessionIntro.sheetTitle")?.parts).toContainEqual({
      type: "text",
      value: "Bereit zur Anprobe?",
    });
    expect(formatter.format("sessionIntro.legalFooter")?.parts).toContainEqual({
      type: "markup",
      kind: "open",
      name: "link",
      options: [{ name: "href", value: "https://studio-vaai.com/try-on/terms" }],
    });
    expect(formatter.format("unknown.key")).toBeUndefined();
    formatter.dispose();
  });
  it("formats host MF2 overrides with arguments, locale number rules, and rich markup", () => {
    const formatter = createMessageFormatter("de", {
      example: "{#b}{$name}{/b}: {$count :number}",
      list: "{$items :list}",
    });
    const result = formatter.format("example", { name: "<img src=x>", count: 1234.5 });
    expect(result?.errors).toEqual([]);
    expect(result?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "string", value: "<img src=x>" })]),
    );
    expect(result?.parts.find((part) => part.type === "number")).toMatchObject({
      parts: expect.arrayContaining([{ kind: "decimal", value: "," }]),
    });
    expect(
      formatter
        .format("list", { items: ["A", "B", "C"] })
        ?.parts.map((part) => ("value" in part ? part.value : ""))
        .join(""),
    ).toContain("A, B und C");
    formatter.dispose();
  });
  it("rejects malformed MF2 overrides", () => {
    expect(() => createMessageFormatter("en", { example: "{broken" })).toThrow(/./);
  });
  it.each(["en", "de"])("formats generic variant and commerce messages in %s", (locale) => {
    const formatter = createMessageFormatter(locale);
    const values = {
      variant: {
        axes: [
          { key: "finish", label: "Sand" },
          { key: "cut", label: "Wide" },
          { key: "wear", label: "Open" },
        ],
        formats: [],
      },
      hasVariant: "yes",
      hasSize: "no",
      hasColor: "no",
      price: "CHF 89.50",
      hasPrice: "yes",
    };
    for (const key of [
      "tryOnView.tryOnVariant",
      "tryOnView.addVariantToCart",
      "tryOnView.variantSummary",
      "tryOnView.variantSoldOut",
    ]) {
      const message = formatter.format(key, values);
      expect(message).toBeDefined();
      expect(message?.errors).toEqual([]);
      expect(message?.parts.map((part) => ("value" in part ? part.value : "")).join("")).toContain(
        "Sand · Wide · Open",
      );
    }
    formatter.dispose();
  });
});
