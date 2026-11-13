// @vitest-environment jsdom
import {
  AxisRole,
  Capability,
  DisplayedImage,
  PresentationMode,
  ItemDisplay,
  Rejection,
  RefusalReason,
  type PresentationView,
  type SelectionView,
} from "@studio-vaai/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  SvTryOnViewActionDetail,
  SvTryOnViewChangeDetail,
  SvTryOnViewScreenProps,
} from "../src/index.js";

import { createUiContext, defineSvElements } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

const SELECTION: SelectionView = {
  labelFormats: [],
  variantId: "variant-medium-blue",
  chosenAxes: ["measurement"],
  recommended: true,
  rows: [
    {
      key: "measurement",
      label: "Cut",
      items: [
        {
          key: "small",
          display: new ItemDisplay.Text({ text: "Small" }),
          selected: false,
          available: false,
          variantId: "variant-small-red",
        },
        {
          key: "medium",
          display: new ItemDisplay.Text({ text: "Medium" }),
          selected: true,
          available: true,
          variantId: "variant-medium-blue",
        },
      ],
    },
    {
      key: "finish",
      label: "Finish",
      items: [
        {
          key: "blue",
          display: new ItemDisplay.Color({ hex: "#446688", alt: "Blue" }),
          selected: true,
          available: true,
          variantId: "variant-medium-blue",
        },
      ],
    },
  ],
};
const PRESENTATION: PresentationView = {
  mode: PresentationMode.Selection,
  displayed: new DisplayedImage.SourcePhoto(),
  tryOns: [],
  axisRows: [],
  canRequestTryOn: new Capability.Available(),
};

async function mount(props: SvTryOnViewScreenProps = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("sv-try-on-view-screen");
  Object.assign(screen, props);
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

describe("Try-on variant selection", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("forwards refused-stock notices without changing the selection", async () => {
    const { screen, changes } = await mount({
      selection: SELECTION,
      presentation: PRESENTATION,
      commerce: { "variant-small-red": { inStock: false } },
    });
    const picker = await child(screen, "sv-variant-picker");
    const options = await child(picker, "sv-option-group");
    const chip = await child(options, "sv-chip");
    chip.click();
    expect(changes).toEqual([
      {
        field: "stockNotice",
        value: { axis: "measurement", item: "small", variantId: "variant-small-red" },
      },
    ]);
    expect(screen.selection).toBe(SELECTION);
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

  it("waits for a Rust selection and capability instead of inventing an incomplete selection", async () => {
    const { screen, actions } = await mount();
    const primary = await press(screen, "primary");
    expect(primary.disabled).toBe(true);
    expect(actions).toEqual([]);
    expect(screen.selection).toBeUndefined();
    expect(screen.error).toBeUndefined();
  });

  it("forwards axis/item intents without mutating the projection or leaking raw picker events", async () => {
    const { host, screen, changes } = await mount({
      selection: SELECTION,
      presentation: PRESENTATION,
    });
    const picker = await child(screen, "sv-variant-picker");
    let leaked = 0;
    host.addEventListener("sv-select", () => {
      leaked += 1;
    });
    const options = await child(picker, "sv-option-group");
    const chip = await child(options, "sv-chip");
    chip.shadowRoot?.querySelector("button")?.click();
    expect(changes).toEqual([{ field: "selection", axis: "measurement", item: "small" }]);
    expect(leaked).toBe(0);
    expect(screen.selection).toBe(SELECTION);
    expect(picker.selection).toBe(SELECTION);
    expect(SELECTION.variantId).toBe("variant-medium-blue");
  });

  it("labels all axes generically and identifies the selected variant in the try-on intent", async () => {
    const { screen, actions } = await mount({ selection: SELECTION, presentation: PRESENTATION });
    const primary = await press(screen, "primary");
    expect(primary.disabled).toBe(false);
    expect(primary.textContent).toContain("Medium · Blue");
    expect(primary.textContent).not.toContain("size");
    await press(screen, "secondary");
    expect(actions).toEqual([
      { action: "try-on", variantId: "variant-medium-blue" },
      { action: "upload" },
    ]);
  });

  it("uses caller combination formats for several size axes without guessing their keys", async () => {
    const selection: SelectionView = {
      ...SELECTION,
      labelFormats: [{ role: AxisRole.Size, format: "W{waist} L{inseam}" }],
      rows: [
        {
          key: "waist",
          role: AxisRole.Size,
          items: [
            {
              key: "27",
              display: new ItemDisplay.Text({ text: "27" }),
              selected: true,
              available: true,
              variantId: SELECTION.variantId,
            },
          ],
        },
        {
          key: "inseam",
          role: AxisRole.Size,
          items: [
            {
              key: "long",
              display: new ItemDisplay.Text({ text: "30 kurz" }),
              selected: true,
              available: true,
              variantId: SELECTION.variantId,
            },
          ],
        },
      ],
    };
    const { host, screen } = await mount({ selection, presentation: PRESENTATION });
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    expect(primary.textContent).toContain("Try ");
    expect(primary.textContent).not.toContain("size");
    expect(primary.textContent).toContain("W27 L30 kurz");
    const context = createUiContext();
    const detach = context.attach(host);
    await context.ready();
    context.configure({ locale: "de" });
    await screen.updateComplete;
    expect(primary.textContent).not.toContain("Größe");
    expect(primary.textContent).toContain("W27 L30 kurz");
    expect(primary.textContent).toContain("anprobieren");
    expect(screen.selection).toBe(selection);
    detach();
  });

  it("uses the Rust capability rather than inferring readiness from selected row flags", async () => {
    const selection: SelectionView = {
      ...SELECTION,
      rows: [
        {
          key: "custom",
          items: [
            {
              key: "one",
              display: new ItemDisplay.Text({ text: "One" }),
              selected: true,
              available: false,
              variantId: SELECTION.variantId,
              refusal: RefusalReason.GarmentTooSmall,
            },
          ],
        },
      ],
    };
    const { screen, actions } = await mount({ selection, presentation: PRESENTATION });
    await press(screen, "primary");
    expect(actions).toHaveLength(1);
    screen.presentation = {
      ...PRESENTATION,
      canRequestTryOn: new Capability.Unavailable({ reason: new Rejection.TryOnUnavailable() }),
    };
    await screen.updateComplete;
    const primary = await press(screen, "primary");
    expect(primary.disabled).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it("locks navigation, picker and action requests while busy", async () => {
    const { screen, changes, actions } = await mount({
      selection: SELECTION,
      presentation: PRESENTATION,
      busy: true,
      error: "Host failure",
    });
    const picker = await child(screen, "sv-variant-picker");
    picker.dispatchEvent(
      new CustomEvent("sv-select", {
        detail: { axis: "measurement", item: "small" },
        bubbles: true,
        composed: true,
      }),
    );
    await press(screen, "primary");
    await press(screen, "secondary");
    expect(actions).toEqual([]);
    expect(changes).toEqual([]);
    expect(picker.disabled).toBe(true);
    const shell = await child(screen, "sv-screen");
    expect(shell.busy).toBe(true);
    await vi.waitFor(() => {
      expect(shell.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe(
        "Requesting try-on",
      );
    });
    expect(screen.error).toBe("Host failure");
  });

  it("passes photo framing to the image and always offers another upload", async () => {
    const crop = { cx: 0.5, cy: 0.5, width: 0.75, height: 1 };
    const { screen, actions } = await mount({
      photoSrc: "/photo.jpg",
      photoCrop: crop,
      selection: SELECTION,
      presentation: PRESENTATION,
    });
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("/photo.jpg");
    expect(image.crop).toBe(crop);
    expect(image.zoomable).toBe(true);
    await press(screen, "secondary");
    expect(actions).toEqual([{ action: "upload" }]);
  });

  it("updates localization without replacing host product or variant labels", async () => {
    const { host, screen } = await mount({
      productName: "Host product",
      selection: SELECTION,
      presentation: PRESENTATION,
    });
    const context = createUiContext();
    const detach = context.attach(host);
    await context.ready();
    context.configure({ locale: "de", appearance: "dark" });
    await screen.updateComplete;
    const shell = await child(screen, "sv-screen");
    expect(shell.heading).toBe("Host product");
    const primary = await child(screen, "sv-button", '[slot="primary"]');
    expect(primary.textContent).toContain("Medium · Blue");
    expect(primary.textContent).toContain("anprobieren");
    expect(screen.selection).toBe(SELECTION);
    expect(screen.dataset.svAppearance).toBe("dark");
    detach();
  });
});
