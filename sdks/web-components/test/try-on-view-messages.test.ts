import { AxisRole } from "@studio-vaai/core";
import { beforeAll, describe, expect, it } from "vitest";

import type { TryOnView } from "../src/screens/try-on-view/view.js";

import { tryOnViewMessages } from "../src/screens/try-on-view/messages.js";
import { ui } from "../src/ui/index.js";
import { initializeTestUi } from "./ui-fixture.js";

const plain = (text: string) => text.replaceAll(/[⁨⁩]/gu, "");

/** The parts of a view these messages read. */
function view(over: Partial<TryOnView>): TryOnView {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the fields the messages read
  return {
    selecting: false,
    pickerSelection: {
      variantId: "m",
      chosenAxes: [],
      recommended: false,
      labelFormats: [],
      rows: [
        { key: "size", role: AxisRole.Size, items: [] },
        { key: "color", role: AxisRole.Color, items: [] },
      ],
    },
    shown: { id: "t", key: { variantId: "m", bodyRevision: 1n }, height: 170, imageUrl: "/t.jpg" },
    shownLabel: { axes: [], formats: [] },
    selectedLabel: {
      axes: [{ key: "size", role: AxisRole.Size, label: "M" }],
      formats: [],
    },
    shownCommerce: { price: "249 €" },
    labelFor: () => ({ axes: [], formats: [] }),
    ...over,
  } as unknown as TryOnView;
}

describe("try-on view messages", () => {
  beforeAll(async () => {
    await initializeTestUi();
  });

  it("names the shown result in the bag action, never 'this variant' when the size is known", () => {
    const messages = tryOnViewMessages(ui, {}, view({}));
    expect(plain(messages.addToCart)).toBe("Add M to bag (249 €)");
  });

  it("calls the collapsed picker what the open picker's heading calls it", () => {
    const messages = tryOnViewMessages(ui, {}, view({}));
    expect(messages.openPicker).toBe("Try another size or color");
    expect(messages.openPicker).toBe(messages.pickerTitle);
  });
});
