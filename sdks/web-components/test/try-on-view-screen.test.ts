import type { PresentationView, Product, SelectionView, TryOn } from "@studio-vaai/core";

// @vitest-environment jsdom
import {
  AxisControl,
  AxisPlacement,
  AxisRole,
  Capability,
  DisplayedImage,
  PresentationMode,
  ItemDisplay,
  ItemGlyph,
  Rejection,
} from "@studio-vaai/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  SvTryOnViewActionDetail,
  SvTryOnViewChangeDetail,
  SvTryOnViewScreenProps,
} from "../src/screens/try-on-view/types.js";

import { createUiContext, defineSvElements } from "../src/index.js";
import { tryOnView } from "../src/screens/try-on-view/view.js";
import { initializeTestUi } from "./ui-fixture.js";

const PRODUCT: Product = {
  id: "shirt",
  variants: [
    {
      id: "v1",
      foreignIds: new Map([
        ["dimension", "M"],
        ["finish", "white"],
        ["wear", "closed"],
      ]),
    },
    {
      id: "v2",
      foreignIds: new Map([
        ["dimension", "S"],
        ["finish", "blue"],
        ["wear", "open"],
      ]),
    },
  ],
};
const SELECTION: SelectionView = {
  labelFormats: [],
  variantId: "v1",
  chosenAxes: ["finish"],
  recommended: true,
  rows: [
    {
      key: "dimension",
      label: "Dimension",
      items: [
        {
          key: "M",
          display: new ItemDisplay.Text({ text: "M" }),
          selected: true,
          available: true,
          variantId: "v1",
        },
        {
          key: "S",
          display: new ItemDisplay.Text({ text: "S" }),
          selected: false,
          available: false,
          variantId: "v2",
        },
      ],
    },
    {
      key: "finish",
      label: "Finish",
      items: [
        {
          key: "white",
          display: new ItemDisplay.Color({ hex: "#ffffff", alt: "White" }),
          selected: true,
          available: true,
          variantId: "v1",
        },
        {
          key: "blue",
          display: new ItemDisplay.Color({ hex: "#51799c", alt: "Blue" }),
          selected: false,
          available: false,
          variantId: "v2",
        },
      ],
    },
    {
      key: "wear",
      label: "Wear",
      items: [
        {
          key: "closed",
          display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtButtoned, alt: "Buttoned" }),
          selected: true,
          available: true,
          variantId: "v1",
        },
        {
          key: "open",
          display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtOpen, alt: "Open" }),
          selected: false,
          available: false,
          variantId: "v2",
        },
      ],
    },
  ],
};
const RESULTS: TryOn[] = [
  {
    id: "earlier",
    key: { variantId: "v1", bodyRevision: 1n },
    height: 168,
    imageUrl: "/earlier.jpg",
  },
  {
    id: "current",
    key: { variantId: "v1", bodyRevision: 2n },
    height: 170,
    imageUrl: "/current.jpg",
  },
  { id: "other", key: { variantId: "v2", bodyRevision: 2n }, height: 170, imageUrl: "/other.jpg" },
];
const PRESENTATION: PresentationView = {
  mode: PresentationMode.Result,
  displayed: new DisplayedImage.TryOn({ tryOnId: "current" }),
  tryOns: ["earlier", "current", "other"],
  canRequestTryOn: new Capability.Available(),
  axisRows: [],
};

const TOOLBAR_OPTIONS = { control: AxisControl.Segmented, placement: AxisPlacement.ResultToolbar };
function toolbarSelection(): SelectionView {
  const selection = nextSelection();
  return {
    ...selection,
    rows: selection.rows.map((row) =>
      row.key === "wear" ? { ...row, displayOptions: TOOLBAR_OPTIONS } : row,
    ),
  };
}
function toolbarPresentation(): PresentationView {
  return {
    ...PRESENTATION,
    axisRows: [
      {
        key: "wear",
        label: "Wear",
        displayOptions: TOOLBAR_OPTIONS,
        items: [
          {
            key: "closed",
            display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtButtoned, alt: "Buttoned" }),
            selected: true,
            variantId: "v1",
            tryOnId: "current",
            canShow: new Capability.Available(),
          },
          {
            key: "open",
            display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtOpen, alt: "Open" }),
            selected: false,
            variantId: "v3",
            tryOnId: "companion",
            canShow: new Capability.Available(),
          },
        ],
      },
    ],
  };
}
function roleSelection(selection: SelectionView = SELECTION): SelectionView {
  return {
    ...selection,
    rows: selection.rows.map((row, index) => ({
      ...row,
      role: [AxisRole.Size, AxisRole.Color, AxisRole.Style][index],
    })),
  };
}

function nextSelection(): SelectionView {
  return {
    ...SELECTION,
    variantId: "v2",
    rows: SELECTION.rows.map((row) => ({
      ...row,
      items: row.items.map((item) => ({ ...item, selected: item.variantId === "v2" })),
    })),
  };
}
async function mount(props: SvTryOnViewScreenProps = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("sv-try-on-view-screen");
  Object.assign(screen, {
    product: PRODUCT,
    selection: SELECTION,
    presentation: PRESENTATION,
    tryOns: RESULTS,
    photoSrc: "/source.jpg",
    ...props,
  });
  host.append(screen);
  document.body.append(host);
  await screen.updateComplete;
  const changes: SvTryOnViewChangeDetail[] = [];
  const actions: SvTryOnViewActionDetail[] = [];
  host.addEventListener("sv-try-on-view-change", (event) => {
    changes.push(event.detail);
  });
  host.addEventListener("sv-try-on-view-action", (event) => {
    actions.push(event.detail);
  });
  return { host, screen, changes, actions };
}
async function child<K extends keyof HTMLElementTagNameMap>(root: Element, tag: K, suffix = "") {
  const el = root.shadowRoot?.querySelector<HTMLElementTagNameMap[K]>(`${tag}${suffix}`);
  if (!el) {
    throw new Error(`Missing ${tag}${suffix}`);
  }
  if ("updateComplete" in el) {
    await el.updateComplete;
  }
  return el;
}
async function press(root: Element, slot: "primary" | "secondary") {
  const el = await child(root, "sv-button", `[slot="${slot}"]`);
  el.shadowRoot?.querySelector("button")?.click();
  return el;
}
function text(value: string | null | undefined) {
  return value?.replaceAll(/[\u2066-\u2069]/gu, "");
}

describe("Rust-aligned stateless try-on view", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("uses the flow's closed picker state while showing a render error", async () => {
    const { screen } = await mount({
      state: "error",
      presentation: { ...PRESENTATION, mode: PresentationMode.Result },
    });
    screen.flowControlled = true;
    await screen.updateComplete;
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    expect(text(primary.textContent)).toMatch(/try another variant/i);
    expect(screen.shadowRoot?.querySelector(".error")?.textContent).toMatch(/try-on/i);
  });

  it("keeps the selection composition through the first request and presents the result on the same screen", async () => {
    const presentation = {
      ...PRESENTATION,
      displayed: new DisplayedImage.SourcePhoto(),
      tryOns: [],
    };
    const selection = toolbarSelection();
    const { screen, actions } = await mount({ presentation, selection });
    const shell = await child(screen, "sv-screen");
    const source = await child(screen, "sv-image");
    const panel = await child(screen, "sv-glass", ".picker-card");
    const picker = await child(screen, "sv-variant-picker");
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    const label = text(primary.textContent);
    expect(shell.panelMode).toBe("overlay");
    expect(shell.description).toBe("Choose a variant to try on");
    expect(picker.selection).toBe(selection);
    expect(source.src).toBe("/source.jpg");
    await press(screen, "primary");
    expect(actions).toEqual([{ action: "try-on", variantId: selection.variantId }]);

    screen.state = "error";
    await screen.updateComplete;
    expect(panel.querySelector("sv-message")?.textContent).toContain("failed");
    expect(text(primary.textContent)).toBe(label);
    await press(screen, "primary");
    expect(actions.at(-1)).toEqual({ action: "retry", variantId: selection.variantId });

    screen.state = "generating";
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-image")).toBe(source);
    expect(screen.shadowRoot?.querySelector(".picker-card")).toBe(panel);
    expect(panel.querySelector("sv-message")).toBeNull();
    expect(picker.disabled).toBe(true);

    screen.presentation = toolbarPresentation();
    screen.state = "ready";
    await screen.updateComplete;
    const result = await child(screen, "sv-image");
    await expect(child(screen, "sv-screen")).resolves.toBe(shell);
    expect(shell.panelMode).toBe("overlay");
    expect(shell.description).toContain("AI generated");
    expect(result.src).toBe("/current.jpg");
    screen.pickerOpen = true;
    await screen.updateComplete;
    await expect(child(screen, "sv-variant-picker")).resolves.toBe(picker);
    expect(picker.selection?.rows.map(({ key }) => key)).toEqual(["dimension", "finish", "wear"]);
    expect(screen.shadowRoot?.querySelector(".picker-card")).toBe(panel);
    expect(panel.querySelector(".picker-toggle")).not.toBeNull();
    await press(screen, "secondary");
    expect(actions.at(-1)).toEqual({ action: "add-to-cart", variantId: "v1", tryOnId: "current" });
  });

  it("opens the mobile picker before requesting a try-on and keeps its state host-owned", async () => {
    const { screen, changes, actions } = await mount({
      selection: nextSelection(),
      fit: { tryOnId: "current", state: "ready", score: 87 },
    });
    const score = await child(screen, "sv-fit-score");
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    expect(text(primary.textContent)).toBe("Try another variant");
    expect(screen.shadowRoot!.querySelector(".picker-slot")!.hasAttribute("inert")).toBe(true);
    await press(screen, "primary");
    expect(changes).toEqual([{ field: "pickerOpen", value: true }]);
    expect(actions).toEqual([]);
    expect(screen.pickerOpen).toBe(false);
    screen.pickerOpen = true;
    await screen.updateComplete;
    expect(text(primary.textContent)).toContain("S · Blue · Open");
    const history = screen.shadowRoot!.querySelector(".history-row")!;
    expect(history.closest("[inert]")).not.toBeNull();
    expect(score.closest(".result-fold")?.hasAttribute("inert")).toBe(true);
    await press(screen, "primary");
    expect(actions).toEqual([{ action: "try-on", variantId: "v2" }]);
    screen.shadowRoot!.querySelector<HTMLButtonElement>(".picker-toggle")!.click();
    expect(changes.at(-1)).toEqual({ field: "pickerOpen", value: false });
    screen.pickerOpen = false;
    await screen.updateComplete;
    expect(text(primary.textContent)).toBe("Try another variant");
    expect(history.closest("[inert]")).toBeNull();
    expect(score.closest(".result-fold")?.hasAttribute("inert")).toBe(false);
  });

  it("keeps the desktop picker open across host disclosure changes and returns to mobile state on resize", async () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly onResize: ResizeObserverCallback;
        constructor(onResize: ResizeObserverCallback) {
          this.onResize = onResize;
        }
        observe(target: Element) {
          observers.set(target, this.onResize);
        }
        unobserve = vi.fn<() => void>();
        disconnect = vi.fn<() => void>();
      },
    );
    const { screen, changes, actions } = await mount();
    const resize = async (width: number) => {
      observers.get(screen)!(
        [{ target: screen, contentRect: { width } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      await screen.updateComplete;
    };
    await resize(800);
    expect(screen.shadowRoot!.querySelector(".picker-card")).not.toBeNull();
    expect(screen.shadowRoot!.querySelector(".picker-toggle")).toBeNull();
    expect(screen.shadowRoot!.querySelector(".picker-slot")!.hasAttribute("inert")).toBe(false);
    const worn = await press(screen, "primary");
    expect(worn.disabled).toBe(true);
    expect(actions).toEqual([]);
    screen.selection = nextSelection();
    await screen.updateComplete;
    await press(screen, "primary");
    expect(actions).toEqual([{ action: "try-on", variantId: "v2" }]);
    screen.pickerOpen = true;
    await screen.updateComplete;
    screen.pickerOpen = false;
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector(".picker-card")).not.toBeNull();
    expect(changes).toEqual([]);
    await resize(400);
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    expect(text(primary.textContent)).toBe("Try another variant");
    expect(screen.pickerOpen).toBe(false);
  });

  it("lets the shopper open unavailable choices while retry still respects admission", async () => {
    const { screen, changes, actions } = await mount({
      presentation: {
        ...PRESENTATION,
        canRequestTryOn: new Capability.Unavailable({
          reason: new Rejection.HeightNotAcknowledged(),
        }),
      },
    });
    const opener = await press(screen, "primary");
    expect(opener.disabled).toBe(false);
    expect(changes).toEqual([{ field: "pickerOpen", value: true }]);
    screen.pickerOpen = true;
    await screen.updateComplete;
    const blocked = await press(screen, "primary");
    expect(blocked.disabled).toBe(true);
    screen.state = "error";
    screen.pickerOpen = false;
    await screen.updateComplete;
    const retry = await press(screen, "primary");
    expect(retry.disabled).toBe(true);
    expect(actions).toEqual([]);
  });

  it("keeps displayed identity, image and commerce separate from a changed selection", async () => {
    const { screen, changes, actions } = await mount({
      pickerOpen: true,
      selection: nextSelection(),
      commerce: { v1: { price: "€89", inStock: true }, v2: { price: "$120", inStock: false } },
      photoCrop: { cx: 0.5, cy: 0.5, width: 0.5, height: 1 },
    });
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("/current.jpg");
    expect(image.crop).toBeUndefined();
    const shell = await child(screen, "sv-screen");
    expect(text(shell.description)).toBe("M · White · Buttoned · AI generated");
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    const secondary = await child(screen, "sv-button", '[slot="secondary"]');
    expect(text(primary.textContent)).toContain("S · Blue · Open");
    expect(text(secondary.textContent)).toContain("€89");
    const picker = await child(screen, "sv-variant-picker");
    picker.dispatchEvent(
      new CustomEvent("sv-select", {
        detail: { axis: "wear", item: "closed" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(changes).toEqual([{ field: "selection", axis: "wear", item: "closed" }]);
    expect(screen.selection?.variantId).toBe("v2");
    expect(screen.presentation).toBe(PRESENTATION);
    await press(screen, "primary");
    await press(screen, "secondary");
    const download = await child(screen, "sv-button", ".download");
    download.shadowRoot?.querySelector("button")?.click();
    expect(actions).toEqual([
      { action: "try-on", variantId: "v2" },
      { action: "add-to-cart", variantId: "v1", tryOnId: "current" },
      { action: "download", tryOnId: "current" },
    ]);
  });

  it("forwards stock explanations without changing either next selection or displayed result", async () => {
    const { screen, changes } = await mount({
      commerce: { v2: { inStock: false } },
      pickerOpen: true,
    });
    const picker = await child(screen, "sv-variant-picker");
    const selection = screen.selection;
    const presentation = screen.presentation;
    const group = picker.shadowRoot!.querySelector("sv-option-group")!;
    await group.updateComplete;
    group.shadowRoot!.querySelectorAll("sv-chip")[1].click();
    expect(changes).toEqual([
      { field: "stockNotice", value: { axis: "dimension", item: "S", variantId: "v2" } },
    ]);
    expect(screen.selection).toBe(selection);
    expect(screen.presentation).toBe(presentation);
    const notice = changes[0];
    if (notice.field !== "stockNotice") {
      throw new Error("Missing stock notice");
    }
    screen.stockNotice = notice.value;
    await screen.updateComplete;
    await picker.updateComplete;
    expect(picker.stockNotice).toBe(notice.value);
    expect(picker.shadowRoot!.querySelector(".note")?.textContent).toContain("sold out");
  });

  it("formats role-aware wording per context while caller labels and result identity stay independent", async () => {
    const { host, screen } = await mount({
      pickerOpen: true,
      productName: "Caller product",
      selection: roleSelection(nextSelection()),
      commerce: { v1: { price: "CHF 89.50", inStock: true } },
      fit: { tryOnId: "current", state: "ready", score: 87 },
    });
    const shell = await child(screen, "sv-screen");
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    const secondary = await child(screen, "sv-button", '[slot="secondary"]');
    const score = await child(screen, "sv-fit-score");
    expect(text(shell.description)).toBe("Size M · White · AI generated");
    expect(text(primary.textContent)).toBe("Try on S in Blue");
    expect(text(secondary.textContent)).toBe("Add M to bag (CHF 89.50)");
    expect(text(score.label)).toBe("Fit Score for M");
    const history = screen.shadowRoot?.querySelectorAll("sv-history-chip");
    expect([...history!].map((chip) => text(chip.textContent))).toEqual(["M · 1", "M · 2", "S"]);
    expect(history?.[0]?.color).toBe("#ffffff");
    expect(text(history?.[0]?.label)).toBe("M, White · 1");

    const context = createUiContext();
    const detach = context.attach(host);
    await context.ready();
    context.configure({ locale: "de" });
    await screen.updateComplete;
    expect(shell.heading).toBe("Caller product");
    expect(text(shell.description)).toBe("Größe M · Farbe White · KI-generiert");
    expect(text(primary.textContent)).toBe("Blue in S anprobieren");
    expect(text(secondary.textContent)).toBe("M in den Warenkorb (CHF 89.50)");
    expect(text(score.label)).toBe("Fit-Score für M");

    // Locale changes SDK wording; only the caller can change product labels.
    screen.selection = {
      ...roleSelection(nextSelection()),
      rows: roleSelection(nextSelection()).rows.map((row) => ({
        ...row,
        items: row.items.map((item) => ({
          ...item,
          display: ItemDisplay.Color.instanceOf(item.display)
            ? new ItemDisplay.Color({
                ...item.display.inner,
                alt: item.key === "white" ? "Weiß" : "Blau",
              })
            : item.display,
        })),
      })),
    };
    await screen.updateComplete;
    expect(text(shell.description)).toBe("Größe M · Farbe Weiß · KI-generiert");
    expect(text(primary.textContent)).toBe("Blau in S anprobieren");
    expect(screen.selection.variantId).toBe("v2");
    detach();
  });

  it("shows the worn combination and exposes tried options and the recommendation shortcut", async () => {
    const { screen, actions } = await mount({
      pickerOpen: true,
      selection: { ...roleSelection(), recommendedVariantId: "v2" },
    });
    const primary = await press(screen, "primary");
    expect(text(primary.textContent)).toBe("You’re wearing M in White");
    expect(primary.disabled).toBe(true);
    expect(actions).toEqual([]);

    const picker = await child(screen, "sv-variant-picker");
    const [sizes, colors] = picker.shadowRoot!.querySelectorAll("sv-option-group");
    expect(sizes).toBeDefined();
    expect(colors).toBeDefined();
    await Promise.all([sizes?.updateComplete, colors?.updateComplete]);
    expect(sizes?.options.map(({ mark }) => mark)).toEqual(["current", "tried"]);
    expect(colors?.options.map(({ mark }) => mark)).toEqual(["tried", undefined]);
    const recommendation =
      picker.shadowRoot!.querySelector<HTMLButtonElement>("button.recommendation");
    expect(text(recommendation?.textContent)?.trim()).toBe("Recommended S");
    recommendation?.click();
    expect(actions).toEqual([{ action: "select-recommendation" }]);
  });

  it("updates tried length and color marks when the selected waist changes", () => {
    const variants = [
      ["selected", "32", "30", "black"],
      ["short-blue", "32", "30", "blue"],
      ["long-black", "32", "34", "black"],
      ["other-waist", "36", "30", "black"],
      ["long-blue", "36", "34", "blue"],
    ].map(([id, waist, length, color]) => ({
      id,
      foreignIds: new Map([
        ["waist", waist],
        ["length", length],
        ["color", color],
      ]),
    }));
    const props: SvTryOnViewScreenProps = {
      product: { id: "trousers", variants },
      bodyRevision: 2n,
      selection: {
        variantId: "selected",
        recommended: false,
        chosenAxes: [],
        labelFormats: [],
        rows: [
          { key: "waist", role: AxisRole.Size, items: [] },
          { key: "length", role: AxisRole.Size, items: [] },
          { key: "color", role: AxisRole.Color, items: [] },
        ],
      },
      tryOns: ["short-blue", "long-black", "long-blue"].map((variantId) => ({
        id: variantId,
        key: { variantId, bodyRevision: 2n },
        height: 170,
        imageUrl: "/result.jpg",
      })),
    };
    const marks = tryOnView(props, true).triedItems;
    expect(marks?.get("length")).toEqual(new Set(["30", "34"]));
    expect(marks?.get("color")).toEqual(new Set(["blue"]));

    props.selection!.variantId = "other-waist";
    const next = tryOnView(props, true).triedItems;
    expect(next?.get("length")).toEqual(new Set(["34"]));
    expect(next?.get("color")).toEqual(new Set());
  });

  it("lets Rust admit a new try-on of the same variant after a body revision change", async () => {
    const { screen, actions } = await mount({ pickerOpen: true, bodyRevision: 3n });
    await press(screen, "primary");
    expect(actions).toEqual([{ action: "try-on", variantId: "v1" }]);
    expect(screen.selection?.variantId).toBe("v1");
  });

  it("switches the projected companion immediately without changing the next selection", async () => {
    const selection = toolbarSelection();
    const presentation = toolbarPresentation();
    const { screen, changes } = await mount({ selection, presentation });
    const picker = await child(screen, "sv-variant-picker");
    expect(picker.selection?.rows.map((row) => row.key)).toEqual(["dimension", "finish", "wear"]);
    const toggle = await child(screen, "sv-option-group");
    expect(toggle.control).toBe(AxisControl.Segmented);
    const segments = toggle.shadowRoot?.querySelectorAll<HTMLButtonElement>("button");
    expect(segments?.[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(segments?.[1]?.getAttribute("aria-pressed")).toBe("false");
    segments?.[1]?.click();
    expect(changes).toEqual([{ field: "displayedImage", tryOnId: "companion" }]);
    expect(screen.selection).toBe(selection);
    expect(screen.selection?.variantId).toBe("v2");
    expect(screen.presentation).toBe(presentation);
    expect(toggle.options[0]?.selected).toBe(true);
    expect(text(screen.shadowRoot?.querySelector("sv-history-chip")?.textContent)).toBe(
      "M · White · 1",
    );
  });

  it("asks Rust to show an uncached toolbar item and respects its projected capability", async () => {
    const presentation = toolbarPresentation();
    delete presentation.axisRows[0].items[1].tryOnId;
    const { screen, changes } = await mount({ selection: toolbarSelection(), presentation });
    const toggle = await child(screen, "sv-option-group");
    toggle.shadowRoot?.querySelectorAll<HTMLButtonElement>("button")[1]?.click();
    expect(changes).toEqual([{ field: "displayedAxis", axis: "wear", item: "open" }]);
    screen.presentation = {
      ...presentation,
      axisRows: presentation.axisRows.map((row) => ({
        ...row,
        items: row.items.map((item) =>
          item.key === "open"
            ? {
                ...item,
                canShow: new Capability.Unavailable({
                  reason: new Rejection.HeightNotAcknowledged(),
                }),
              }
            : item,
        ),
      })),
    };
    await screen.updateComplete;
    await toggle.updateComplete;
    expect(toggle.shadowRoot?.querySelectorAll<HTMLButtonElement>("button")[1]?.disabled).toBe(
      true,
    );
    toggle.dispatchEvent(
      new CustomEvent("sv-change", { detail: { value: "open" }, bubbles: true, composed: true }),
    );
    expect(changes).toHaveLength(1);
  });

  it("uses the result identity supplied by Rust, even when other body revisions are cached", async () => {
    const presentation = toolbarPresentation();
    const results = [
      ...RESULTS,
      {
        id: "older-companion",
        key: { variantId: "v3", bodyRevision: 1n },
        height: 168,
        imageUrl: "/old-companion.jpg",
      },
      {
        id: "companion",
        key: { variantId: "v3", bodyRevision: 2n },
        height: 170,
        imageUrl: "/companion.jpg",
      },
    ];
    const { screen, changes } = await mount({
      selection: toolbarSelection(),
      presentation,
      tryOns: results,
    });
    const toggle = await child(screen, "sv-option-group");
    toggle.shadowRoot?.querySelectorAll<HTMLButtonElement>("button")[1]?.click();
    expect(changes).toEqual([{ field: "displayedImage", tryOnId: "companion" }]);
    screen.presentation = {
      ...presentation,
      displayed: new DisplayedImage.TryOn({ tryOnId: "companion" }),
      tryOns: ["companion"],
    };
    await screen.updateComplete;
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("/companion.jpg");
    expect(screen.selection?.variantId).toBe("v2");
  });

  it("locks the toolbar during generation and removes it when no result is displayed", async () => {
    const presentation = toolbarPresentation();
    const { screen, changes } = await mount({
      selection: toolbarSelection(),
      presentation,
      state: "generating",
    });
    const toolbar = await child(screen, "sv-option-group");
    const options = [...toolbar.shadowRoot!.querySelectorAll("button")];
    expect(options).toHaveLength(2);
    expect(options.every((button) => button.disabled)).toBe(true);
    options[1]?.click();
    expect(changes).toEqual([]);
    screen.state = "ready";
    screen.presentation = { ...presentation, displayed: new DisplayedImage.SourcePhoto() };
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-option-group")).toBeNull();
  });

  it("obeys the experience capability for requests instead of row availability or commerce stock", async () => {
    const { screen, actions } = await mount({
      pickerOpen: true,
      selection: nextSelection(),
      commerce: { v2: { inStock: false } },
    });
    // The selected target changes the other axes; available=false does not prevent trying it on.
    await press(screen, "primary");
    expect(actions).toEqual([{ action: "try-on", variantId: "v2" }]);
    screen.presentation = {
      ...PRESENTATION,
      canRequestTryOn: new Capability.Unavailable({
        reason: new Rejection.HeightNotAcknowledged(),
      }),
    };
    await screen.updateComplete;
    const primary = await press(screen, "primary");
    expect(primary.disabled).toBe(true);
    screen.state = "error";
    await screen.updateComplete;
    await press(screen, "primary");
    expect(primary.disabled).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it("uses real try-on IDs and preserves distinct results of the same variant at different heights", async () => {
    const { screen, changes } = await mount();
    const history = screen.shadowRoot?.querySelectorAll("sv-history-chip");
    expect(history).toHaveLength(3);
    expect([...history!].map((item) => text(item.textContent))).toEqual([
      "M · White · Buttoned · 1",
      "M · White · Buttoned · 2",
      "S · Blue · Open",
    ]);
    history?.[0]?.click();
    history?.[1]?.click();
    expect(changes).toEqual([
      { field: "displayedImage", tryOnId: "earlier" },
      { field: "displayedImage", tryOnId: "current" },
    ]);
    expect(screen.presentation?.displayed).toBe(PRESENTATION.displayed);
    screen.presentation = {
      ...PRESENTATION,
      displayed: new DisplayedImage.TryOn({ tryOnId: "earlier" }),
    };
    await screen.updateComplete;
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("/earlier.jpg");
  });

  it.each([new DisplayedImage.SourcePhoto(), new DisplayedImage.TryOn({ tryOnId: "missing" })])(
    "shows source photo safely when no actual displayed result can be resolved: %j",
    async (displayed) => {
      const crop = { cx: 0.5, cy: 0.5, width: 0.5, height: 1 };
      const { screen, actions } = await mount({
        presentation: { ...PRESENTATION, displayed },
        photoCrop: crop,
        fit: { tryOnId: "current", state: "ready", score: 88 },
      });
      const image = await child(screen, "sv-image");
      expect(image.src).toBe("/source.jpg");
      expect(image.crop).toEqual(crop);
      expect(screen.shadowRoot?.querySelector(".download")).toBeNull();
      expect(screen.shadowRoot?.querySelector("sv-fit-score")).toBeNull();
      const secondary = await press(screen, "secondary");
      expect(secondary.disabled).toBe(false);
      expect(actions).toEqual([{ action: "upload" }]);
    },
  );

  it("lets shoppers open callouts when the intended-fit description is absent", async () => {
    const { screen, changes } = await mount({
      fit: {
        tryOnId: "current",
        state: "ready",
        score: 87,
        callouts: [{ key: "chest", label: "Chest", description: "Fits perfectly", x: 0.4, y: 0.3 }],
      },
    });
    const score = await child(screen, "sv-fit-score");
    const button = score.shadowRoot!.querySelector("button")!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(changes).toContainEqual({ field: "fitDetailsOpen", value: true });
    screen.fitDetailsOpen = true;
    await screen.updateComplete;
    expect(screen.shadowRoot!.querySelector(".callouts")?.hasAttribute("inert")).toBe(false);
  });

  it("ignores stale fit data and retries when changing to another result of the same variant", async () => {
    const { screen, actions } = await mount({
      fit: {
        tryOnId: "current",
        state: "ready",
        score: 87,
        description: "Regular fit",
        callouts: [{ key: "chest", label: "Chest", x: 0.4, y: 0.3 }],
      },
      fitDetailsOpen: true,
    });
    const oldScore = await child(screen, "sv-fit-score");
    expect(screen.shadowRoot?.querySelectorAll(".anchor")).toHaveLength(1);
    screen.presentation = {
      ...PRESENTATION,
      displayed: new DisplayedImage.TryOn({ tryOnId: "earlier" }),
    };
    await screen.updateComplete;
    const placeholder = await child(screen, "sv-fit-score");
    expect(placeholder.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder.loading).toBe(true);
    expect(placeholder.score).toBeUndefined();
    expect(screen.shadowRoot?.querySelectorAll(".anchor")).toHaveLength(0);
    screen.fit = { tryOnId: "current", state: "error" };
    await screen.updateComplete;
    oldScore.dispatchEvent(new CustomEvent("sv-retry", { bubbles: true, composed: true }));
    expect(actions).toEqual([]);
    screen.fit = { tryOnId: "earlier", state: "error" };
    await screen.updateComplete;
    const score = await child(screen, "sv-fit-score");
    score.dispatchEvent(new CustomEvent("sv-retry", { bubbles: true, composed: true }));
    expect(actions).toEqual([{ action: "retry-fit-score", tryOnId: "earlier" }]);
  });

  it("shows initial fit loading without a fabricated score and stops duplicate retries", async () => {
    const { screen, actions } = await mount({ fit: { tryOnId: "current", state: "error" } });
    const score = await child(screen, "sv-fit-score");
    screen.fit = { tryOnId: "current", state: "loading" };
    await screen.updateComplete;
    const pending = await child(screen, "sv-fit-score");
    expect(pending.loading).toBe(true);
    expect(pending.shadowRoot?.querySelector(".bar.loading sv-spinner")).not.toBeNull();
    expect(pending.shadowRoot?.textContent).not.toContain("0%");
    // A queued request from the old control must not start a second request.
    screen.dispatchEvent(new CustomEvent("sv-retry", { bubbles: true, composed: true }));
    score.dispatchEvent(new CustomEvent("sv-retry", { bubbles: true, composed: true }));
    expect(actions).toEqual([]);
    screen.fit = { tryOnId: "current", state: "ready", score: 92 };
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector(".fit-loading")).toBeNull();
    const readyScore = await child(screen, "sv-fit-score");
    expect(readyScore.score).toBe(92);
  });

  it.each([{ busy: true }, { state: "generating" as const }])(
    "keeps disclosures readable while blocking consequential changes during %j",
    async (work) => {
      const { screen, changes, actions } = await mount({
        ...work,
        pickerOpen: true,
        fit: { tryOnId: "current", state: "ready", score: 87, description: "Regular fit" },
      });
      const score = await child(screen, "sv-fit-score");
      score.shadowRoot?.querySelector<HTMLButtonElement>("button.bar")?.click();
      screen.shadowRoot!.querySelector<HTMLButtonElement>(".picker-toggle")!.click();
      expect(changes).toEqual([
        { field: "fitDetailsOpen", value: true },
        { field: "pickerOpen", value: false },
      ]);
      expect(screen.fitDetailsOpen).toBe(false);
      expect(screen.pickerOpen).toBe(true);
      const variantPicker = await child(screen, "sv-variant-picker");
      expect(variantPicker.disabled).toBe(true);
      await press(screen, "primary");
      await press(screen, "secondary");
      expect(actions).toEqual([]);
    },
  );

  it("uses the default error only when omitted and preserves host errors during busy work", async () => {
    const { screen } = await mount({ state: "error" });
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toContain("failed");
    screen.error = "";
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")).toBeNull();
    screen.error = "Host error";
    screen.busy = true;
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe("Host error");
    screen.error = undefined;
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toContain("failed");
  });

  it("normalizes disclosure and fit retry requests and does not leak child control events", async () => {
    const { host, screen, changes, actions } = await mount({
      fit: { tryOnId: "current", state: "error" },
      pickerOpen: true,
    });
    const raw: string[] = [];
    for (const name of ["sv-toggle", "sv-select", "sv-retry"]) {
      host.addEventListener(name, () => {
        raw.push(name);
      });
    }
    const score = await child(screen, "sv-fit-score");
    score.dispatchEvent(
      new CustomEvent("sv-toggle", { detail: { open: true }, bubbles: true, composed: true }),
    );
    screen.shadowRoot!.querySelector<HTMLButtonElement>(".picker-toggle")!.click();
    score.dispatchEvent(new CustomEvent("sv-retry", { bubbles: true, composed: true }));
    expect(changes).toEqual([
      { field: "fitDetailsOpen", value: true },
      { field: "pickerOpen", value: false },
    ]);
    expect(actions).toEqual([{ action: "retry-fit-score", tryOnId: "current" }]);
    expect(screen.fitDetailsOpen).toBe(false);
    expect(screen.pickerOpen).toBe(true);
    expect(raw).toEqual([]);
  });

  it("renders only valid image-relative fit anchors and leaves the active callout controlled", async () => {
    const { screen, changes } = await mount({
      fitDetailsOpen: true,
      fit: {
        tryOnId: "current",
        state: "ready",
        score: 87,
        callouts: [
          { key: "chest", label: "Chest", description: "Fits", x: 0.4, y: 0.3 },
          { key: "bad", label: "Bad", x: Number.NaN, y: 0.5 },
        ],
      },
    });
    const image = await child(screen, "sv-image");
    expect(image.querySelector('[slot="overlay"]')).not.toBeNull();
    const anchors = screen.shadowRoot?.querySelectorAll<HTMLButtonElement>(".anchor");
    expect(anchors).toHaveLength(1);
    expect(anchors?.[0]?.getAttribute("aria-label")).toBe("Chest: Fits");
    expect(screen.shadowRoot?.querySelector(".callout[data-active]")).toBeNull();
    const card = screen.shadowRoot?.querySelector<HTMLButtonElement>(".callout");
    card?.dispatchEvent(new Event("pointerenter"));
    card?.dispatchEvent(new Event("pointerleave"));
    expect(changes).toEqual([]);
    anchors?.[0]?.click();
    expect(changes).toEqual([{ field: "activeCalloutKey", value: "chest" }]);
    expect(screen.activeCalloutKey).toBeUndefined();
    screen.activeCalloutKey = "chest";
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelectorAll(".callout[data-active]")).toHaveLength(1);
    card?.click();
    expect(changes.at(-1)).toEqual({ field: "activeCalloutKey", value: undefined });
    expect(screen.activeCalloutKey).toBe("chest");
    screen.activeCalloutKey = undefined;
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector(".callout[data-active]")).toBeNull();
  });

  it("keeps closing annotations mounted for their exit while immediately removing interaction", async () => {
    const { screen } = await mount({
      fitDetailsOpen: true,
      fit: {
        tryOnId: "current",
        state: "ready",
        score: 87,
        callouts: [{ key: "chest", label: "Chest", x: 0.4, y: 0.3 }],
      },
    });
    const overlay = screen.shadowRoot?.querySelector<HTMLElement>(".callouts");
    const annotation = overlay?.querySelector(".annotation");
    const point = overlay?.querySelector(".anchor");
    expect(overlay?.dataset.open).toBe("");
    screen.fitDetailsOpen = false;
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector(".callouts")).toBe(overlay);
    expect(overlay?.querySelector(".annotation")).toBe(annotation);
    expect(overlay?.querySelector(".anchor")).toBe(point);
    expect(overlay?.dataset.open).toBeUndefined();
    expect(overlay?.hasAttribute("inert")).toBe(true);
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    screen.fitDetailsOpen = true;
    await screen.updateComplete;
    expect(overlay?.querySelector(".annotation")).toBe(annotation);
    expect(overlay?.hasAttribute("inert")).toBe(false);
    expect(overlay?.getAttribute("aria-hidden")).toBe("false");
  });

  it("locks history, selection and actions during foreground work", async () => {
    const { screen, changes, actions } = await mount({ state: "generating" });
    const image = await child(screen, "sv-image");
    const shell = await child(screen, "sv-screen");
    expect(image.busy).toBe(true);
    expect(shell.busy).toBe(true);
    expect(screen.shadowRoot?.textContent).toContain("Fetching the tape measure");
    await press(screen, "primary");
    await press(screen, "secondary");
    const history = await child(screen, "sv-history-chip");
    history.click();
    const picker = await child(screen, "sv-variant-picker");
    picker.dispatchEvent(
      new CustomEvent("sv-select", { detail: { axis: "dimension", item: "S" }, bubbles: true }),
    );
    expect(actions).toEqual([]);
    expect(changes).toEqual([]);
    expect(screen.state).toBe("generating");
    expect(screen.presentation).toBe(PRESENTATION);
    expect(screen.shadowRoot?.querySelector(".download")).toBeNull();
  });

  it("blocks only displayed sold-out commerce and retries the selected variant", async () => {
    const { screen, actions } = await mount({
      state: "error",
      selection: nextSelection(),
      commerce: { v1: { inStock: false }, v2: { inStock: true } },
    });
    expect(text(screen.shadowRoot?.textContent)).toContain("Try-on for S · Blue · Open failed");
    expect(text(screen.shadowRoot?.textContent)).toContain(
      "M · White · Buttoned is currently sold out.",
    );
    await press(screen, "primary");
    const secondary = await press(screen, "secondary");
    expect(secondary.disabled).toBe(true);
    expect(actions).toEqual([{ action: "retry", variantId: "v2" }]);
    screen.commerce = { v1: { inStock: true } };
    screen.state = "ready";
    await screen.updateComplete;
    await press(screen, "secondary");
    expect(actions.at(-1)).toEqual({ action: "add-to-cart", variantId: "v1", tryOnId: "current" });
  });

  it("changes locale and appearance without resetting selection, result or disclosure", async () => {
    const { host, screen } = await mount({
      pickerOpen: true,
      fitDetailsOpen: true,
      commerce: { v1: { price: "€89" } },
    });
    const ui = createUiContext();
    const detach = ui.attach(host);
    await ui.ready();
    ui.configure({ locale: "de", appearance: "dark" });
    await screen.updateComplete;
    const secondary = await child(screen, "sv-button", '[slot="secondary"]');
    expect(text(secondary.textContent)).toContain("M · White · Buttoned");
    expect(secondary.textContent).toContain("€89");
    expect(secondary.textContent).not.toContain("Add");
    const shell = await child(screen, "sv-screen");
    expect(text(shell.description)).toBe("M · White · Buttoned · KI-generiert");
    expect(screen.pickerOpen).toBe(true);
    expect(screen.fitDetailsOpen).toBe(true);
    expect(screen.selection).toBe(SELECTION);
    expect(screen.presentation).toBe(PRESENTATION);
    expect(screen.dataset.svAppearance).toBe("dark");
    detach();
  });
});
