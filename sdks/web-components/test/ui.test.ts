// @vitest-environment jsdom
import { afterEach, describe, beforeAll, expect, it } from "vitest";

import { defineSvElements, createUiContext, ui } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

describe("shared SDK UI", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
    ui.configure({ locale: "en", appearance: "light", messages: {} });
  });

  it("updates the shared default and keeps business state unchanged", async () => {
    const screen = document.createElement("sv-session-intro-screen");
    screen.consented = true;
    screen.photoFactsOpen = true;
    document.body.append(screen);
    await screen.updateComplete;
    ui.configure({ locale: "de-CH", appearance: "dark" });
    await screen.updateComplete;
    const shell = screen.shadowRoot?.querySelector("sv-screen");
    await shell?.updateComplete;
    expect(shell?.heading).toBe("Bereit zur Anprobe?");
    expect(shell?.lang).toBe("de-CH");
    expect(screen.dataset.svAppearance).toBe("dark");
    expect(screen.consented).toBe(true);
    expect(screen.photoFactsOpen).toBe(true);
    expect("locale" in screen).toBe(false);
    expect("appearance" in screen).toBe(false);
  });

  it("isolates nested roots, rebinds mounted children, and restores enclosing scopes", async () => {
    const outer = document.createElement("div");
    outer.lang = "fr";
    const inner = document.createElement("div");
    const button = document.createElement("sv-button");
    inner.append(button);
    outer.append(inner);
    document.body.append(outer);
    await button.updateComplete;
    const german = createUiContext({ locale: "de", appearance: "dark" });
    const english = createUiContext({ locale: "en", appearance: "light" });
    const detachOuter = german.attach(outer);
    const detachInner = english.attach(inner);
    await Promise.all([german.ready(), english.ready()]);
    expect(Object.hasOwn(button.dataset, "svAppearance")).toBe(false);
    german.configure({ appearance: "light", locale: "de-CH" });
    expect(inner.lang).toBe("en");
    german.configure({ appearance: "dark" });
    detachInner();
    expect(button.dataset.svAppearance).toBe("dark");
    expect(inner.hasAttribute("lang")).toBe(false);
    detachOuter();
    expect(Object.hasOwn(button.dataset, "svAppearance")).toBe(false);
    expect(outer.lang).toBe("fr");
    expect(Object.hasOwn(outer.dataset, "svAppearance")).toBe(false);
    ui.configure({ appearance: "dark" });
    expect(button.dataset.svAppearance).toBe("dark");
    button.remove();
    ui.configure({ appearance: "light" });
    expect(button.dataset.svAppearance).toBe("dark");
    inner.append(button);
    expect(Object.hasOwn(button.dataset, "svAppearance")).toBe(false);
  });

  it("can scope an SDK element directly without losing the root's light appearance marker", async () => {
    const button = document.createElement("sv-button");
    button.textContent = "Continue";
    document.body.append(button);
    const context = createUiContext({ appearance: "dark" });
    const detach = context.attach(button);
    await button.updateComplete;
    expect(button.dataset.svAppearance).toBe("dark");
    context.configure({ appearance: "light" });
    await button.updateComplete;
    expect(button.dataset.svAppearance).toBe("light");
    expect(button.textContent).toBe("Continue");
    expect(context.snapshot.status).toBe("loading");
    detach();
    expect(button.dataset.svAppearance).toBeUndefined();
  });

  it("rejects invalid overrides atomically and falls back for unsupported languages", async () => {
    const context = createUiContext({ locale: "fr-CA" });
    await context.ready();
    expect(context.text("sessionIntro.sheetTitle")).toBe("Ready to try it on?");
    expect(context.snapshot.resolvedLocale).toBe("en");
    const snapshot = context.snapshot;
    expect(() => {
      context.configure({ locale: "de", messages: { "sessionIntro.sheetTitle": "{broken" } });
    }).toThrow(/./);
    expect(context.snapshot).toBe(snapshot);
    expect(context.text("sessionIntro.sheetTitle")).toBe("Ready to try it on?");
    // Rejected sources must not opt the context into the unsupported locale.
    context.configure({ appearance: "dark" });
    expect(context.snapshot.resolvedLocale).toBe("en");
  });

  it("renders MF2 text and allowed markup without creating arbitrary HTML or unsafe links", async () => {
    const context = createUiContext({
      messages: {
        "sessionIntro.legalFooter":
          "{#link href=|javascript:alert(1)|}Unsafe{/link} <img src=x> {#b}Bold{/b}",
      },
    });
    await context.ready();
    const root = document.createElement("div");
    const detach = context.attach(root);
    const screen = document.createElement("sv-session-intro-screen");
    root.append(screen);
    document.body.append(root);
    await screen.updateComplete;
    const legal = screen.shadowRoot?.querySelector(".legal");
    expect(legal?.textContent).toContain("Unsafe <img src=x> Bold");
    expect(legal?.querySelector("a, img")).toBeNull();
    expect(legal?.querySelector("strong")?.textContent).toBe("Bold");
    detach();
  });

  it("keeps caller locale formatting independent from the shipped fallback text", async () => {
    const context = createUiContext({ locale: "fr_CA" });
    await context.ready();
    expect(context.snapshot.locale).toBe("fr-CA");
    expect(context.snapshot.resolvedLocale).toBe("en");
    expect(context.snapshot.catalogLocale).toBe("en");
    context.configure({ messages: {} });
    expect(context.snapshot.resolvedLocale).toBe("fr-CA");
    context.configure({ messages: { list: "{$values :list}" } });
    expect(context.text("list", { values: ["A", "B", "C"] })).toContain("A, B et C");
    expect(context.text("sessionIntro.sheetTitle")).toBe("Ready to try it on?");
    const snapshot = context.snapshot;
    expect(() => {
      context.configure({ locale: "de", messages: { list: "{broken" } });
    }).toThrow(/./);
    expect(context.snapshot).toBe(snapshot);
    expect(context.text("list", { values: ["A", "B", "C"] })).toContain("A, B et C");
    context.configure({ messages: undefined });
    expect(context.snapshot.resolvedLocale).toBe("en");
    expect(context.snapshot.messages).toEqual({});
    expect(context.format("list", { values: ["A", "B", "C"] })).toBeUndefined();
    context.configure({ appearance: "dark" });
    expect(context.snapshot.resolvedLocale).toBe("en");
    context.configure({ locale: "de_CH" });
    expect(context.snapshot.resolvedLocale).toBe("de-CH");
    expect(context.snapshot.catalogLocale).toBe("de");
    context.configure({ locale: "not a locale!" });
    expect(context.snapshot.locale).toBe("en");
    expect(context.snapshot.resolvedLocale).toBe("en");
  });
});
