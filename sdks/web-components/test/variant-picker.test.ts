// @vitest-environment jsdom
import {
  AxisControl,
  AxisPlacement,
  AxisRole,
  ItemDisplay,
  ItemGlyph,
  RefusalReason,
  type SelectionView,
} from "@studio-vaai/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SvSelectDetail, SvVariantPicker } from "../src/index.js";

import { createUiContext, defineSvElements } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

function selection(): SelectionView {
  return {
    variantId: "black-m",
    labelFormats: [],
    chosenAxes: ["fabric"],
    recommended: true,
    rows: [
      {
        key: "fit",
        role: AxisRole.Size,
        label: "Fit",
        items: [
          {
            key: "m",
            display: new ItemDisplay.Text({ text: "M" }),
            selected: true,
            available: true,
            variantId: "black-m",
          },
          {
            key: "s",
            display: new ItemDisplay.Text({ text: "S" }),
            selected: false,
            available: true,
            variantId: "black-s",
            refusal: RefusalReason.GarmentTooSmall,
          },
          {
            key: "xl",
            display: new ItemDisplay.Text({ text: "XL" }),
            selected: false,
            available: false,
          },
        ],
      },
      {
        key: "fabric",
        label: "Fabric",
        items: [
          {
            key: "black",
            display: new ItemDisplay.Color({ hex: "#242426", alt: "Black" }),
            selected: true,
            available: true,
            variantId: "black-m",
          },
          {
            key: "print",
            display: new ItemDisplay.Image({
              url: "https://example.test/swatch.jpg",
              alt: "Printed linen",
            }),
            selected: false,
            available: false,
            variantId: "print-s",
          },
        ],
      },
      {
        key: "wearing",
        label: "Wear it",
        items: [
          {
            key: "buttoned",
            display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtButtoned, alt: "Buttoned" }),
            selected: true,
            available: true,
            variantId: "black-m",
          },
          {
            key: "open",
            display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtOpen, alt: "Open" }),
            selected: false,
            available: true,
            variantId: "black-m-open",
          },
        ],
      },
    ],
  };
}

async function mountPicker(props: Partial<SvVariantPicker>): Promise<SvVariantPicker> {
  const el = document.createElement("sv-variant-picker");
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function chips(el: SvVariantPicker): HTMLElementTagNameMap["sv-chip"][] {
  return [...(el.shadowRoot?.querySelectorAll("sv-option-group") ?? [])].flatMap((group) => [
    ...(group.shadowRoot?.querySelectorAll("sv-chip") ?? []),
  ]);
}

function selections(el: SvVariantPicker): SvSelectDetail[] {
  const seen: SvSelectDetail[] = [];
  el.addEventListener("sv-select", (event) => {
    seen.push(event.detail);
  });
  return seen;
}

describe("sv-variant-picker", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders generic rows and all shared display kinds without special axis names", async () => {
    const el = await mountPicker({ selection: selection() });
    expect(
      [...el.shadowRoot!.querySelectorAll('[part="label"]')].map((node) =>
        node.textContent?.replaceAll(/[\u2066-\u2069]/gu, ""),
      ),
    ).toEqual(["Fit: M", "Fabric: Black", "Wear it: Buttoned"]);
    const all = chips(el);
    expect(all[0]?.selected).toBe(true);
    expect(all[3]?.color).toBe("#242426");
    expect(all[3]?.label).toBe("Black");
    expect(all[4]?.image).toBe("https://example.test/swatch.jpg");
    expect(all[4]?.label).toBe("Printed linen");
    expect(all[5]?.querySelector("sv-icon")?.name).toBe("shirt-buttoned");
    expect(all[6]?.querySelector("sv-icon")?.name).toBe("shirt-open");
    expect(all[6]?.label).toBe("Open");
  });

  it("marks the selected size before a try-on is completed", async () => {
    const el = await mountPicker({ selection: selection() });
    const [selected, otherSize, , selectedSwatch] = chips(el);
    await selected?.updateComplete;
    expect(selected?.shadowRoot?.querySelector('[data-mark="current"]')).toBeInstanceOf(Element);
    expect(otherSize?.mark).toBeUndefined();
    expect(selectedSwatch?.mark).toBeUndefined();
  });

  it("formats caller headings and selected labels through the shared message context", async () => {
    const projected = selection();
    const el = await mountPicker({ selection: projected });
    const context = createUiContext({
      locale: "de",
      messages: { "tryOnView.variantAxisLabel": "{$axisLabel} / {$valueLabel}" },
    });
    const detach = context.attach(el);
    await context.ready();
    await el.updateComplete;
    expect(
      el.shadowRoot
        ?.querySelector('[part="label"]')
        ?.textContent?.replaceAll(/[\u2066-\u2069]/gu, ""),
    ).toBe("Fit / M");
    expect(el.selection).toBe(projected);
    expect(projected.rows[0].label).toBe("Fit");
    detach();
  });

  it("distinguishes recommendation, refusal, a fallback target and no target", async () => {
    const el = await mountPicker({ selection: selection() });
    const all = chips(el);
    expect(all[0]?.status).toBe("recommended");
    expect(all[1]?.status).toBe("refused");
    expect(all[1]?.disabled).toBe(false);
    expect(all[1]?.description).toBe("Too small for your body.");
    expect(all[2]?.disabled).toBe(true);
    expect(all[2]?.description).toBe("No variant has this option.");
    expect(all[3]?.status).toBeUndefined();
    expect(all[4]?.status).toBe("unavailable");
    expect(all[4]?.disabled).toBe(false);
    expect(all[4]?.description).toBe("Choosing this option also changes another choice.");
  });

  it("connects additional descriptions to native text and swatch buttons", async () => {
    const el = await mountPicker({ selection: selection() });
    const all = chips(el);
    await Promise.all(
      [1, 4].map(async (index) => {
        const chip = all[index];
        chip.description = "This choice changes the result.";
        await chip.updateComplete;
        expect(chip.shadowRoot?.querySelector("button")?.getAttribute("aria-describedby")).toBe(
          "description",
        );
        expect(chip.shadowRoot?.getElementById("description")?.textContent).toBe(
          "This choice changes the result.",
        );
        chip.description = undefined;
        await chip.updateComplete;
        expect(chip.shadowRoot?.querySelector("button")?.hasAttribute("aria-describedby")).toBe(
          chip.status !== undefined,
        );
        if (chip.status === undefined) {
          expect(chip.shadowRoot?.getElementById("description")).toBeNull();
        } else {
          expect(
            chip.shadowRoot?.getElementById("description")?.textContent?.length ?? 0,
          ).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("reports Rust item identifiers for ordinary, refused and fallback choices", async () => {
    const el = await mountPicker({ selection: selection() });
    const seen = selections(el);
    const all = chips(el);
    all[0]?.click();
    all[1]?.click();
    all[4]?.click();
    all[6]?.click();
    expect(seen).toEqual([
      { axis: "fit", item: "m" },
      { axis: "fit", item: "s" },
      { axis: "fabric", item: "print" },
      { axis: "wearing", item: "open" },
    ]);
  });

  it("refuses sold-out picks and replaces the recommendation only after host acceptance", async () => {
    const projected = selection();
    projected.rows[0].role = AxisRole.Size;
    const commerce = { "black-s": { inStock: false } };
    const el = await mountPicker({ selection: projected, commerce });
    const seen = selections(el);
    const notices: HTMLElementEventMap["sv-stock-notice"]["detail"][] = [];
    el.addEventListener("sv-stock-notice", (event) => {
      notices.push(event.detail);
    });
    const firstRow = el.shadowRoot!.querySelector('[part="row"]')!;
    expect(
      firstRow.querySelector("sv-badge")?.textContent?.replaceAll(/[\u2066-\u2069]/gu, ""),
    ).toContain("Recommended M");
    const soldOut = chips(el)[1];
    await soldOut.updateComplete;
    expect(soldOut.status).toBe("sold-out");
    expect(soldOut.disabled).toBe(false);
    expect(soldOut.description).toBe("sold out");
    expect(soldOut.shadowRoot!.querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
    soldOut.shadowRoot!.querySelector("button")!.click();
    expect(seen).toEqual([]);
    expect(notices).toEqual([{ value: { axis: "fit", item: "s", variantId: "black-s" } }]);
    expect(el.stockNotice).toBeUndefined();
    expect(projected.variantId).toBe("black-m");
    el.stockNotice = notices[0].value;
    await el.updateComplete;
    expect(firstRow.querySelector("sv-badge")).toBeNull();
    expect(firstRow.querySelector(".note")?.textContent).toContain("Size");
    expect(firstRow.querySelector(".note")?.textContent).toContain("S");
    expect(firstRow.querySelector(".note")?.textContent).toContain("currently sold out");
    chips(el)[0].click();
    expect(notices[1]).toEqual({ value: undefined });
    expect(seen).toEqual([{ axis: "fit", item: "m" }]);
    expect(el.stockNotice).toEqual(notices[0].value);
    el.stockNotice = undefined;
    await el.updateComplete;
    expect(firstRow.querySelector(".note")).toBeNull();
    expect(firstRow.querySelector("sv-badge")).not.toBeNull();
  });

  it("ignores stale stock explanations and preserves unknown stock and missing targets", async () => {
    const el = await mountPicker({
      selection: selection(),
      commerce: { "black-s": { inStock: false } },
      stockNotice: { axis: "fit", item: "s", variantId: "another-variant" },
    });
    expect(el.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim()).toBe("");
    el.stockNotice = { axis: "fit", item: "s", variantId: "black-s" };
    el.commerce = { "black-s": { inStock: true } };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim()).toBe("");
    expect(chips(el)[1].status).toBe("refused");
    expect(chips(el)[2].disabled).toBe(true);
    const seen = selections(el);
    chips(el)[4].click();
    expect(seen).toEqual([{ axis: "fabric", item: "print" }]);
  });

  it("applies stock presentation and refusal to segmented selection axes", async () => {
    const projected = selection();
    projected.rows[0].displayOptions = {
      control: AxisControl.Segmented,
      placement: AxisPlacement.Picker,
    };
    const el = await mountPicker({
      selection: projected,
      commerce: { "black-s": { inStock: false } },
    });
    const seen = selections(el);
    const notices: unknown[] = [];
    el.addEventListener("sv-stock-notice", (event) => {
      notices.push(event.detail);
    });
    const toggle = el.shadowRoot!.querySelector("sv-option-group")!;
    await toggle.updateComplete;
    const soldOut = toggle.shadowRoot!.querySelectorAll("button")[1];
    expect(soldOut.disabled).toBe(false);
    expect(soldOut.getAttribute("aria-disabled")).toBe("true");
    expect(soldOut.dataset.status).toBe("sold-out");
    soldOut.click();
    expect(seen).toEqual([]);
    expect(notices).toEqual([{ value: { axis: "fit", item: "s", variantId: "black-s" } }]);
    el.disabled = true;
    await el.updateComplete;
    await toggle.updateComplete;
    soldOut.click();
    expect(notices).toHaveLength(1);
  });

  it("does not mutate selection until the host supplies a fresh projection", async () => {
    const projected = selection();
    const el = await mountPicker({ selection: projected });
    chips(el)[4]?.click();
    await el.updateComplete;
    expect(el.selection).toBe(projected);
    expect(projected.variantId).toBe("black-m");
    expect(chips(el)[3]?.selected).toBe(true);
    expect(chips(el)[4]?.selected).toBe(false);

    const next = selection();
    next.variantId = "print-s";
    next.rows[1].items[0].selected = false;
    next.rows[1].items[1].selected = true;
    el.selection = next;
    await el.updateComplete;
    expect(chips(el)[3]?.selected).toBe(false);
    expect(chips(el)[4]?.selected).toBe(true);
  });

  it("blocks no-target and globally disabled requests even for direct host clicks", async () => {
    const el = await mountPicker({ selection: selection() });
    const seen = selections(el);
    chips(el)[2]?.click();
    expect(seen).toEqual([]);
    el.disabled = true;
    await el.updateComplete;
    expect(chips(el).every((chip) => chip.disabled)).toBe(true);
    chips(el)[0]?.click();
    expect(seen).toEqual([]);
  });

  it("renders an absent selection or heading without inventing an axis", async () => {
    const el = await mountPicker({});
    expect(chips(el)).toEqual([]);
    const projected = selection();
    delete projected.rows[0].label;
    el.selection = projected;
    await el.updateComplete;
    expect(
      el.shadowRoot?.querySelector('[part="row"]')?.querySelector('[part="label"]'),
    ).toBeNull();
  });

  it("honors segmented axis display hints without introducing another selection source", async () => {
    const projected = selection();
    projected.rows[0].displayOptions = {
      control: AxisControl.Segmented,
      placement: AxisPlacement.Picker,
    };
    const el = await mountPicker({ selection: projected });
    const toggle = el.shadowRoot!.querySelector("sv-option-group")!;
    await toggle.updateComplete;
    expect(toggle.control).toBe(AxisControl.Segmented);
    const buttons = toggle.shadowRoot!.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].disabled).toBe(false);
    expect(buttons[2].disabled).toBe(true);
    const seen = selections(el);
    const leaked: unknown[] = [];
    el.addEventListener("sv-change", (event) => {
      leaked.push(event.detail);
    });
    buttons[1].click();
    expect(seen).toEqual([{ axis: "fit", item: "s" }]);
    expect(leaked).toEqual([]);
    expect(projected.rows[0].items[0].selected).toBe(true);
    el.disabled = true;
    await el.updateComplete;
    await toggle.updateComplete;
    expect(buttons[0].disabled).toBe(true);
  });
});
