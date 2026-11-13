import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defineSvElements } from "../src/index.js";
// @vitest-environment jsdom
import { createUiContext, ui } from "../src/ui/index.js";
import { initializeTestUi } from "./ui-fixture.js";

async function guide(locale?: string): Promise<SVGSVGElement> {
  const el = document.createElement("sv-photo-guide");
  if (locale !== undefined) {
    ui.configure({ locale });
  }
  document.body.append(el);
  await el.updateComplete;
  const img = el.shadowRoot?.querySelector("svg");
  if (!img) {
    throw new Error("no img");
  }
  await vi.waitFor(() => {
    expect(img.querySelector("image")?.hasAttribute("href")).toBe(true);
  });
  return img;
}

describe("sv-photo-guide", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("exposes the English photo instructions as one named illustration", async () => {
    const img = await guide();
    expect(img.querySelector("image")?.getAttribute("href")).toMatch(/guide-people-light\.webp/);
    expect(img.textContent).toContain("Natural pose");
    expect(img.getAttribute("focusable")).toBe("false");
    expect(img.getAttribute("role")).toBe("img");
    expect(img.getAttribute("aria-label")).toContain(
      "Full body: Head to toe. Natural pose. Regular clothing (not oversized)",
    );
  });

  it("matches the language of a regional locale, and falls back to English", async () => {
    const swiss = await guide("de-CH");
    expect(swiss.textContent?.replace(/\s+/g, " ")).toContain("NatürlichePose");
    document.body.replaceChildren();
    const french = await guide("fr");
    expect(french.textContent).toContain("Natural pose");
  });

  it("switches clothing with the host appearance while keeping the labels and layout", async () => {
    const svg = await guide("de");
    const el = document.querySelector("sv-photo-guide");
    if (!el) {
      throw new Error("no guide");
    }
    ui.configure({ appearance: "dark" });
    await vi.waitFor(() => {
      expect(svg.querySelector("image")?.getAttribute("href")).toMatch(/guide-people-dark\.webp/);
    });
    expect(svg.textContent?.replace(/\s+/g, " ")).toContain("NatürlichePose");
    expect(svg.querySelectorAll("text")).toHaveLength(3);
    ui.configure({ appearance: "light" });
    await vi.waitFor(() => {
      expect(svg.querySelector("image")?.getAttribute("href")).toMatch(/guide-people-light\.webp/);
    });
  });

  it("inherits a screen's scope through its shadow tree", async () => {
    const root = document.createElement("div");
    const context = createUiContext({ appearance: "dark", locale: "de" });
    const detach = context.attach(root);
    await context.ready();
    const screen = document.createElement("sv-session-intro-screen");
    root.append(screen);
    document.body.append(root);
    await screen.updateComplete;
    const guide = screen.shadowRoot?.querySelector("sv-photo-guide");
    await guide?.updateComplete;
    expect(guide?.dataset.svAppearance).toBe("dark");
    expect(guide?.shadowRoot?.textContent).toContain("Natürliche");
    context.configure({ appearance: "light" });
    expect(guide?.dataset.svAppearance).toBeUndefined();
    detach();
  });
});
