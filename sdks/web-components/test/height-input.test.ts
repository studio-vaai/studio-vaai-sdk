import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
import type { SvHeightInput } from "../src/index.js";

import { defineSvElements } from "../src/index.js";

async function mount(props: Partial<SvHeightInput>): Promise<SvHeightInput> {
  const el = document.createElement("sv-height-input");
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Every value the element asked for. */
function asked(el: SvHeightInput): number[] {
  const values: number[] = [];
  el.addEventListener("sv-change", (event) => {
    values.push(Number(event.detail.value));
  });
  return values;
}

function input(el: SvHeightInput): HTMLInputElement {
  const found = el.shadowRoot?.querySelector("input");
  if (!found) {
    throw new Error("no input");
  }
  return found;
}

function type(field: HTMLInputElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new Event("input"));
}

function key(target: Element, name: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

describe("sv-height-input", () => {
  beforeAll(() => {
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("is a named spin button over 140–220 cm, the stepper without a touch screen", async () => {
    const el = await mount({ value: 175, label: "How tall are you?" });
    expect(el.resolvedMode).toBe("stepper");
    const field = input(el);
    expect(field.getAttribute("role")).toBe("spinbutton");
    expect(field.getAttribute("aria-label")).toBe("How tall are you?");
    expect(field.getAttribute("aria-valuenow")).toBe("175");
    expect(field.getAttribute("aria-valuemin")).toBe("140");
    expect(field.getAttribute("aria-valuemax")).toBe("220");
    expect(field.value).toBe("175");
  });

  it("asks for a typed height on Enter and on blur, clamped to the range", async () => {
    const el = await mount({ value: 175 });
    const values = asked(el);
    const field = input(el);
    type(field, "182");
    key(field, "Enter");
    type(field, "250");
    field.dispatchEvent(new Event("blur"));
    expect(values).toEqual([182, 220]);
  });

  it("keeps digits only while typing, and goes back to the value when nothing is typed", async () => {
    const el = await mount({ value: 175 });
    const values = asked(el);
    const field = input(el);
    type(field, "18x5 cm");
    expect(field.value).toBe("185");
    type(field, "");
    field.dispatchEvent(new Event("blur"));
    await el.updateComplete;
    expect(values).toEqual([]);
    expect(field.value).toBe("175");
  });

  it("shows only what the owner sets: a refused value goes back", async () => {
    const el = await mount({ value: 175 });
    const field = input(el);
    type(field, "190");
    key(field, "Enter");
    await el.updateComplete;
    expect(field.value).toBe("175");
    el.value = 190;
    await el.updateComplete;
    expect(field.value).toBe("190");
  });

  it("steps by 1 cm with the arrow keys and buttons, and not past the range", async () => {
    const el = await mount({ value: 220 });
    const values = asked(el);
    key(input(el), "ArrowDown");
    key(input(el), "ArrowUp");
    const [up, down] = [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>(".step") ?? [])];
    expect(up?.disabled).toBe(true);
    down?.click();
    // Up from the top asks nothing; the owner never answered, so both steps start at 220.
    expect(values).toEqual([219, 219]);
  });

  it("disabled, can't be typed into or stepped", async () => {
    const el = await mount({ value: 175, disabled: true });
    expect(input(el).disabled).toBe(true);
    const buttons = [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>(".step") ?? [])];
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("as a wheel, asks for the row it comes to rest on", async () => {
    const el = await mount({ value: 175, mode: "wheel", label: "How tall are you?" });
    const values = asked(el);
    const scroller = el.shadowRoot?.querySelector<HTMLElement>(".scroller");
    if (!scroller) {
      throw new Error("no wheel");
    }
    expect(scroller.getAttribute("role")).toBe("spinbutton");
    expect(scroller.getAttribute("aria-valuetext")).toBe("175 cm");
    // jsdom has no layout: give the rows their height.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 200, height: 24 }),
    );
    scroller.scrollTop = (180 - 140) * 24 + 5;
    scroller.dispatchEvent(new Event("scrollend"));
    key(scroller, "ArrowUp");
    expect(values).toEqual([180, 176]);
  });
});
