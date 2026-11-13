// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defineSvElements, SV_ICON_NAMES } from "../src/index.js";
import {
  svAppearanceStyle,
  SV_DARK_APPEARANCE,
  SV_PUBLIC_TOKENS,
} from "../src/internal/theme/index.js";
import { svTokens } from "../src/styles/tokens.js";
import { initializeTestUi } from "./ui-fixture.js";

async function mount<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text = "",
): Promise<HTMLElementTagNameMap[K]> {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }
  el.textContent = text;
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

function inner(el: Element, selector: string): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`${selector} not rendered`);
  }
  return found;
}

/** Collects what an `sv-checkbox` asks for. */
function changes(el: HTMLElement): boolean[] {
  const asked: boolean[] = [];
  el.addEventListener("sv-change", (event) => {
    asked.push(event.detail.value === true);
  });
  return asked;
}

describe("sv elements", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  describe("defineSvElements", () => {
    it("can run twice, as when a shop loads the SDK twice", () => {
      expect(() => {
        defineSvElements();
      }).not.toThrow();
      expect(customElements.get("sv-button")).toBeDefined();
    });
  });

  describe("sv-button", () => {
    it("adds no attributes of its own, so server-rendered markup hydrates unchanged", async () => {
      const el = await mount("sv-button", {}, "Try on M");
      expect(el.variant).toBeUndefined();
      expect(el.size).toBeUndefined();
      expect(el.getAttributeNames()).toEqual([]);
      expect(inner(el, "button").getAttribute("type")).toBe("button");
    });

    it("passes a press through as a click", async () => {
      const el = await mount("sv-button");
      const onClick = vi.fn<(event: Event) => void>();
      el.addEventListener("click", onClick);
      inner(el, "button").click();
      expect(onClick).toHaveBeenCalledOnce();
    });

    it("does not report presses while busy", async () => {
      const el = await mount("sv-button", { busy: "" });
      const onClick = vi.fn<(event: Event) => void>();
      el.addEventListener("click", onClick);
      inner(el, "button").click();
      expect(onClick).not.toHaveBeenCalled();
      expect(inner(el, "button").getAttribute("aria-busy")).toBe("true");
      expect(el.shadowRoot?.querySelector("sv-spinner")).not.toBeNull();
    });

    it("disables the native button", async () => {
      const el = await mount("sv-button", { disabled: "" });
      expect(inner(el, "button").hasAttribute("disabled")).toBe(true);
    });
  });

  describe("sv-dialog drawer", () => {
    it("returns from a canceled drag and starts a re-grab at the visible offset", async () => {
      vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
      const el = await mount("sv-dialog");
      const dialog = el.shadowRoot!.querySelector("dialog")!;
      dialog.showModal = () => {
        dialog.open = true;
      };
      dialog.close = () => {
        dialog.open = false;
      };
      Object.assign(dialog, {
        setPointerCapture: vi.fn<HTMLDialogElement["setPointerCapture"]>(),
      });
      dialog.getBoundingClientRect = () => new DOMRect(0, 0, 320, 500);
      el.open = true;
      await el.updateComplete;

      const dismiss = vi.fn<() => void>();
      el.addEventListener("sv-dismiss", dismiss);
      const grabber = inner(el, ".grabber");
      const pointer = (target: HTMLElement, type: string, clientY: number) => {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientY }));
      };
      pointer(grabber, "pointerdown", 0);
      pointer(dialog, "pointermove", 200);
      expect(dialog.style.transform).toBe("translateY(200px)");
      pointer(dialog, "pointercancel", 200);
      expect(dialog.style.transform).toBe("");
      expect(dismiss).not.toHaveBeenCalled();
      expect(dialog.open).toBe(true);

      vi.stubGlobal(
        "DOMMatrixReadOnly",
        class {
          m42 = 80;
        },
      );
      dialog.style.transform = "matrix(1, 0, 0, 1, 0, 80)";
      pointer(grabber, "pointerdown", 100);
      expect(dialog.style.transform).toBe("translateY(80px)");
      pointer(dialog, "pointermove", 120);
      expect(dialog.style.transform).toBe("translateY(100px)");
      pointer(dialog, "lostpointercapture", 120);
      expect(dialog.style.transform).toBe("");
      expect(dismiss).not.toHaveBeenCalled();
    });
  });

  describe("sv-badge", () => {
    it("reflects its variant", async () => {
      const el = await mount("sv-badge", {}, "Recommended M");
      el.variant = "positive";
      await el.updateComplete;
      expect(el.getAttribute("variant")).toBe("positive");
    });
  });

  describe("sv-screen", () => {
    it("always shows back and close with shared accessible names", async () => {
      const el = await mount("sv-screen", { heading: "Your height" });
      expect(inner(el, "h2").textContent).toBe("Your height");
      expect(inner(el, ".back").getAttribute("aria-label")).toBe("Back");
      expect(inner(el, ".close").getAttribute("aria-label")).toBe("Close");
      const fired = vi.fn<() => void>();
      el.addEventListener("sv-back", fired);
      inner(el, ".back").click();
      expect(fired).toHaveBeenCalledOnce();
    });

    it("wires close and the header for sv-dialog, and disables both buttons while busy", async () => {
      const el = await mount("sv-screen", {
        busy: "",
      });
      expect(inner(el, ".close").dataset.svDismiss).toBe("");
      expect(inner(el, ".header").dataset.svSwipe).toBe("");
      expect(inner(el, ".close").hasAttribute("disabled")).toBe(true);
      expect(inner(el, ".back").hasAttribute("disabled")).toBe(true);
    });

    it("keeps both action slots, so the primary has one place on every step", async () => {
      const el = await mount("sv-screen");
      const slots = [...inner(el, ".actions").querySelectorAll("slot")].map((slot) => slot.name);
      expect(slots).toEqual(["before-actions", "primary", "secondary"]);
    });
  });

  describe("sv-checkbox", () => {
    it("asks to change from the box and the text, and waits for the owner", async () => {
      const el = await mount("sv-checkbox", {}, "I consent");
      const asked = changes(el);
      inner(el, ".box").click();
      inner(el, ".text").click();
      expect(asked).toEqual([true, true]);
      expect(inner(el, ".box").getAttribute("aria-checked")).toBe("false");
      el.checked = true;
      await el.updateComplete;
      expect(inner(el, ".box").getAttribute("aria-checked")).toBe("true");
    });

    it("leaves the box alone when a link in the text is pressed", async () => {
      const el = await mount("sv-checkbox");
      el.innerHTML = 'I consent. <a href="#privacy">Privacy</a>';
      await el.updateComplete;
      const asked = changes(el);
      el.querySelector("a")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
      expect(asked).toEqual([]);
    });

    it("asks nothing while disabled", async () => {
      const el = await mount("sv-checkbox", { disabled: "" }, "I consent");
      const asked = changes(el);
      inner(el, ".text").click();
      expect(asked).toEqual([]);
    });
  });

  describe("sv-chip", () => {
    it("is a toggle button that reports selection", async () => {
      const el = await mount("sv-chip", { selected: "" }, "M");
      expect(inner(el, "button").getAttribute("aria-pressed")).toBe("true");
      el.selected = false;
      await el.updateComplete;
      expect(inner(el, "button").getAttribute("aria-pressed")).toBe("false");
    });

    it("lets sold-out and refused sizes be pressed, so the picker can explain them", async () => {
      const soldOut = await mount("sv-chip", { status: "sold-out" }, "L");
      const refused = await mount("sv-chip", { status: "refused" }, "XL");
      const pressed = vi.fn<() => void>();
      soldOut.addEventListener("click", pressed);
      refused.addEventListener("click", pressed);
      inner(soldOut, "button").click();
      inner(refused, "button").click();
      expect(pressed).toHaveBeenCalledTimes(2);
      expect(inner(soldOut, "button").getAttribute("aria-disabled")).toBe("true");
    });

    it("draws a swatch named by its label, with a check readable on its color", async () => {
      const el = await mount("sv-chip", { color: "#18366d", label: "Navy", selected: "" });
      const button = inner(el, "button");
      expect(button.classList.contains("swatch")).toBe(true);
      expect(button.getAttribute("aria-label")).toBe("Navy");
      expect(inner(el, ".disc").style.background).toBe("rgb(24, 54, 109)");
      expect(inner(el, ".check").style.color).toBe("rgb(255, 255, 255)");
    });

    it("lays a fabric photo over the color, without a check, and falls back to the color", async () => {
      const el = await mount("sv-chip", {
        color: "#3866b0",
        image: "/fabric.jpg",
        label: "Mid Blue",
        selected: "",
      });
      const img = inner(el, ".disc img");
      expect(img.getAttribute("src")).toBe("/fabric.jpg");
      expect(el.shadowRoot?.querySelector(".check")).toBeNull();
      img.dispatchEvent(new Event("error"));
      expect(img.hidden).toBe(true);
      expect(inner(el, ".disc").style.background).toBe("rgb(56, 102, 176)");
    });

    it("rings a white swatch so it doesn't vanish on paper", async () => {
      const white = await mount("sv-chip", { color: "#ffffff", label: "White" });
      const navy = await mount("sv-chip", { color: "#18366d", label: "Navy" });
      expect(inner(white, "button").classList.contains("light")).toBe(true);
      expect(inner(navy, "button").classList.contains("light")).toBe(false);
    });
  });

  describe("sv-disclosure", () => {
    it("shows the heading and opens when `open` is set, without reporting it", async () => {
      const el = await mount("sv-disclosure", { heading: "What happens to my photo?" });
      const details = inner(el, "details");
      expect(inner(el, "summary").textContent).toContain("What happens to my photo?");
      expect(details.hasAttribute("open")).toBe(false);
      const fired = vi.fn<() => void>();
      el.addEventListener("sv-toggle", fired);
      el.open = true;
      await el.updateComplete;
      details.dispatchEvent(new Event("toggle"));
      expect(details.hasAttribute("open")).toBe(true);
      expect(fired).not.toHaveBeenCalled();
    });

    it("mirrors a press on the native element and reports it", async () => {
      const el = await mount("sv-disclosure", { heading: "Fit details" });
      const details = inner(el, "details");
      const opened: boolean[] = [];
      el.addEventListener("sv-toggle", (event) => {
        opened.push(event.detail.open);
      });
      details.setAttribute("open", "");
      details.dispatchEvent(new Event("toggle"));
      await el.updateComplete;
      expect(el.open).toBe(true);
      expect(el.hasAttribute("open")).toBe(true);
      expect(opened).toEqual([true]);
    });
  });

  describe("sv-icon", () => {
    it.each(SV_ICON_NAMES)("draws %s, decorative unless labelled", async (name) => {
      const el = await mount("sv-icon", { name });
      const drawn = inner(el, "svg");
      expect(drawn.childElementCount).toBeGreaterThan(0);
      expect(drawn.getAttribute("aria-hidden")).toBe("true");
    });

    it("names itself for screen readers when labelled", async () => {
      const el = await mount("sv-icon", { name: "x", label: "Close" });
      const drawn = inner(el, "svg");
      expect(drawn.getAttribute("role")).toBe("img");
      expect(drawn.getAttribute("aria-label")).toBe("Close");
      expect(drawn.hasAttribute("aria-hidden")).toBe(false);
    });

    it("draws nothing for an unknown name", async () => {
      const el = await mount("sv-icon", { name: "constructor" });
      expect(el.shadowRoot?.querySelector("svg")).toBeNull();
    });
  });

  describe("sv-spinner", () => {
    it("is hidden from screen readers without a label", async () => {
      const el = await mount("sv-spinner");
      const ring = inner(el, ".spinner");
      expect(ring.getAttribute("aria-hidden")).toBe("true");
      expect(ring.hasAttribute("role")).toBe(false);
    });

    it("is a status with a label", async () => {
      const el = await mount("sv-spinner", { label: "Uploading photo" });
      const ring = inner(el, ".spinner");
      expect(ring.getAttribute("role")).toBe("status");
      expect(ring.getAttribute("aria-label")).toBe("Uploading photo");
      expect(ring.hasAttribute("aria-hidden")).toBe(false);
    });
  });

  describe("svAppearanceStyle", () => {
    it("is empty for light and sets every dark value as a public property", () => {
      expect(svAppearanceStyle("light")).toEqual({});
      const dark = svAppearanceStyle("dark");
      const { seeds, steps, fixed } = SV_DARK_APPEARANCE;
      expect(Object.keys(dark)).toHaveLength(
        Object.keys(seeds).length + Object.keys(steps).length + Object.keys(fixed).length,
      );
      expect(dark["--sv-background"]).toBe("#151517");
      expect(dark["--sv-mix-muted"]).toBe("14%");
      expect(dark["--sv-opacity-photo-overlay"]).toBe("96%");
    });
  });

  describe("svTokens", () => {
    it("reads only the public token names", () => {
      const read = new Set(
        Array.from(svTokens.cssText.matchAll(/var\(--sv-([a-z0-9-]+)/g), (m) => m[1]),
      );
      const publicNames = new Set<string>(SV_PUBLIC_TOKENS);
      expect([...read].filter((name) => name !== undefined && !publicNames.has(name))).toEqual([]);
    });

    it("does not expose weights, shadows or motion", () => {
      expect(svTokens.cssText).not.toMatch(/--sv-(font-weight|shadow|ease|duration)/);
    });
  });
});
