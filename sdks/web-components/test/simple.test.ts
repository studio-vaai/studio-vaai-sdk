import { Capability, ItemDisplay, ItemGlyph } from "@studio-vaai/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// @vitest-environment jsdom

import { defineSvElements } from "../src/index.js";

async function mount<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  text = "",
): Promise<HTMLElementTagNameMap[K]> {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.textContent = text;
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

function all(el: Element, selector: string): HTMLElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
}

describe("simple elements", () => {
  beforeAll(() => {
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("sv-steps numbers its steps in an ordered list, discs hidden from screen readers", async () => {
    const el = await mount("sv-steps", {
      items: ["Upload a photo", "Enter your height", "Try different sizes"],
    });
    const items = all(el, "li");
    expect(items.map((li) => li.textContent?.replaceAll(/\s+/g, " ").trim())).toEqual([
      "1 Upload a photo",
      "2 Enter your height",
      "3 Try different sizes",
    ]);
    expect(all(el, ".number").every((n) => n.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("sv-fact-list draws an icon beside each sentence", async () => {
    const el = await mount("sv-fact-list", {
      items: [
        { icon: "check", text: "Stays on your device" },
        { icon: "info", text: "Deleted after 30 days" },
      ],
    });
    expect(all(el, "sv-icon").map((i) => i.getAttribute("name"))).toEqual(["check", "info"]);
    expect(all(el, "li")[1]?.textContent).toContain("Deleted after 30 days");
  });

  it("sv-message is an alert when destructive and a status when neutral", async () => {
    const error = await mount("sv-message", {}, "Try-on failed");
    const info = await mount(
      "sv-message",
      { variant: "neutral", layout: "card" },
      "Stand 2 m back",
    );
    expect(all(error, ".message")[0]?.getAttribute("role")).toBe("alert");
    expect(all(error, "sv-icon")[0]?.getAttribute("name")).toBe("circle-alert");
    expect(all(info, ".message")[0]?.getAttribute("role")).toBe("status");
    expect(all(info, "sv-icon")[0]?.getAttribute("name")).toBe("info");
  });

  it("sv-powered-by names itself once for screen readers", async () => {
    const el = await mount("sv-powered-by");
    const lockup = all(el, ".lockup")[0];
    expect(lockup?.getAttribute("role")).toBe("img");
    expect(lockup?.getAttribute("aria-label")).toBe("powered by studio vaai");
    expect(all(el, "svg path").length).toBe(3);
  });

  it("sv-style-toggle renders the presentation row and asks for the pressed item", async () => {
    const el = await mount("sv-style-toggle", {
      row: {
        key: "wearing",
        label: "Style",
        items: [
          {
            key: "buttoned",
            variantId: "buttoned-variant",
            display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtButtoned, alt: "Buttoned" }),
            selected: true,
            canShow: new Capability.Available(),
          },
          {
            key: "open",
            variantId: "open-variant",
            display: new ItemDisplay.Glyph({ glyph: ItemGlyph.ShirtOpen, alt: "Open" }),
            selected: false,
            canShow: new Capability.Available(),
          },
        ],
      },
    });
    const seen: unknown[] = [];
    el.addEventListener("sv-change", (event) => {
      seen.push(event.detail.value);
    });
    const segments = all(el, ".segment");
    expect(segments.map((s) => s.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    segments[1]?.click();
    expect(seen).toEqual(["open"]);
    expect(all(el, ".group")[0]?.getAttribute("aria-label")).toBe("Style");
  });

  it("sv-history-chip shows its colorway and reports presses", async () => {
    const el = await mount(
      "sv-history-chip",
      { color: "#ffffff", label: "S, White", selected: true },
      "S",
    );
    const button = all(el, ".chip")[0];
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.getAttribute("aria-label")).toBe("S, White");
    expect(all(el, ".dot")[0]?.classList.contains("ringed")).toBe(true);
    const pressed = vi.fn<() => void>();
    el.addEventListener("click", pressed);
    button?.click();
    expect(pressed).toHaveBeenCalledOnce();
  });
});
