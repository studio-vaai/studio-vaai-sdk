import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { SelectionView, VariantAxis } from "../src/experience/index.js";

import {
  ItemDisplay,
  ItemGlyph,
  itemDisplayText,
  selectionLabelValue,
  variantLabelValue,
  AxisRole,
} from "../src/experience/index.js";
import { initializeCore } from "../src/runtime.js";

describe("Rust variant display projections", () => {
  const axes: VariantAxis[] = [
    {
      key: "finish",
      role: AxisRole.Color,
      items: [{ key: "sand", display: ItemDisplay.Color.new({ hex: "#d1b995", alt: "Sand" }) }],
    },
    {
      key: "cut",
      role: AxisRole.Size,
      items: [
        { key: "wide", display: ItemDisplay.Text.new({ text: "Wide" }) },
        { key: "slim", display: ItemDisplay.Text.new({ text: "Slim" }) },
      ],
    },
    {
      key: "wearing",
      role: AxisRole.Style,
      items: [
        {
          key: "open",
          display: ItemDisplay.Glyph.new({ glyph: ItemGlyph.ShirtOpen, alt: "Open" }),
        },
      ],
    },
  ];
  const variants = [
    {
      id: "shown",
      foreignIds: new Map([
        ["cut", "wide"],
        ["wearing", "open"],
        ["finish", "sand"],
      ]),
    },
    {
      id: "next",
      foreignIds: new Map([
        ["cut", "slim"],
        ["wearing", "open"],
        ["finish", "sand"],
      ]),
    },
  ];
  const selection: SelectionView = {
    variantId: "next",
    labelFormats: [{ role: AxisRole.Size, format: "Cut {cut}" }],
    chosenAxes: ["cut"],
    recommended: false,
    rows: axes.map((axis) => ({
      ...axis,
      items: axis.items.map((item) => ({
        ...item,
        selected: variants[1].foreignIds.get(axis.key) === item.key,
        available: true,
        variantId: "next",
      })),
    })),
  };

  it("uses host display order and arbitrary axis keys without conflating displayed and selected variants", async () => {
    await initializeCore(
      new Uint8Array(await readFile(new URL("../dist/studio_vaai_core.wasm", import.meta.url))),
    );
    expect(selectionLabelValue(selection)).toEqual({
      axes: [
        { key: "finish", role: AxisRole.Color, label: "Sand" },
        { key: "cut", role: AxisRole.Size, label: "Slim" },
        { key: "wearing", role: AxisRole.Style, label: "Open" },
      ],
      formats: [{ role: AxisRole.Size, format: "Cut {cut}" }],
    });
    expect(
      variantLabelValue("shown", variants, selection.rows, selection.labelFormats).axes[1]?.label,
    ).toBe("Wide");
    expect(selection.variantId).toBe("next");
    expect(variantLabelValue("unknown", variants, axes).axes).toEqual([]);
  });

  it("uses image alternative text and shared glyph names without invoking WASM", () => {
    expect(itemDisplayText(ItemDisplay.Image.new({ url: "fabric.webp", alt: "Checked" }))).toBe(
      "Checked",
    );
    expect(
      itemDisplayText(ItemDisplay.Glyph.new({ glyph: ItemGlyph.ShirtButtoned, alt: "Buttoned" })),
    ).toBe("Buttoned");
  });
});
