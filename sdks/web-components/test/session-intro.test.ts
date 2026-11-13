// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  SvSessionIntroActionDetail,
  SvSessionIntroChangeDetail,
  SvSessionIntroScreenProps,
} from "../src/index.js";

import { defineSvElements } from "../src/index.js";
import { createUiContext } from "../src/ui/index.js";
import { initializeTestUi } from "./ui-fixture.js";

async function mount(props: SvSessionIntroScreenProps = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("sv-session-intro-screen");
  Object.assign(screen, props);
  host.append(screen);
  document.body.append(host);
  await screen.updateComplete;
  const changes: SvSessionIntroChangeDetail[] = [];
  const actions: SvSessionIntroActionDetail["action"][] = [];
  host.addEventListener("sv-session-intro-change", (e) => {
    changes.push(e.detail);
  });
  host.addEventListener("sv-session-intro-action", (e) => {
    actions.push(e.detail.action);
  });
  return { screen, host, changes, actions };
}

async function child<K extends keyof HTMLElementTagNameMap>(
  root: Element,
  tag: K,
  suffix = "",
): Promise<HTMLElementTagNameMap[K]> {
  const found = root.shadowRoot?.querySelector<HTMLElementTagNameMap[K]>(`${tag}${suffix}`);
  if (!found) {
    throw new Error(`${tag}${suffix} missing`);
  }
  if ("updateComplete" in found) {
    await found.updateComplete;
  }
  return found;
}
function nativeButton(el: Element): HTMLButtonElement {
  const button = el.shadowRoot?.querySelector("button");
  if (!button) {
    throw new Error("button missing");
  }
  return button;
}
async function press(root: Element, slot: "primary" | "secondary"): Promise<HTMLButtonElement> {
  const el = await child(root, "sv-button", `[slot="${slot}"]`);
  const button = nativeButton(el);
  button.click();
  return button;
}

describe("stateless session intro", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("requests consent without changing consent, errors, or disclosures", async () => {
    const { screen, host, changes } = await mount();
    const checkbox = await child(screen, "sv-checkbox");
    const leaked: unknown[] = [];
    host.addEventListener("sv-change", (e) => {
      leaked.push(e.detail);
    });
    nativeButton(checkbox).click();
    await screen.updateComplete;
    expect(changes).toEqual([{ field: "consented", value: true }]);
    expect(leaked).toEqual([]);
    expect(screen.consented).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(screen.error).toBeUndefined();
    expect(screen.photoFactsOpen).toBe(false);
    expect(screen.withdrawalOpen).toBe(false);
    screen.consented = true;
    await screen.updateComplete;
    await checkbox.updateComplete;
    expect(checkbox.checked).toBe(true);
  });

  it.each([
    ["privacy", "photoFactsOpen"],
    ["withdrawal", "withdrawalOpen"],
  ] as const)(
    "keeps the %s disclosure controlled until the host accepts",
    async (cssClass, field) => {
      const { screen, host, changes } = await mount();
      const disclosure = await child(screen, "sv-disclosure", `.${cssClass}`);
      const summary = disclosure.shadowRoot?.querySelector("summary");
      const details = disclosure.shadowRoot?.querySelector("details");
      const leaked: unknown[] = [];
      host.addEventListener("sv-toggle", (e) => {
        leaked.push(e.detail);
      });
      summary?.click();
      await disclosure.updateComplete;
      expect(changes).toEqual([{ field, value: true }]);
      expect(leaked).toEqual([]);
      expect(screen[field]).toBe(false);
      expect(disclosure.open).toBe(false);
      expect(details?.open).toBe(false);
      screen[field] = true;
      await screen.updateComplete;
      await disclosure.updateComplete;
      expect(details?.open).toBe(true);
      details?.dispatchEvent(new Event("toggle"));
      expect(changes).toHaveLength(1);
      summary?.click();
      expect(changes.at(-1)).toEqual({ field, value: false });
      expect(screen[field]).toBe(true);
      expect(details?.open).toBe(true);
    },
  );

  it("reports missing consent without creating validation state, then requests the chosen action", async () => {
    const { screen, actions } = await mount();
    const upload = await press(screen, "primary");
    expect(upload.disabled).toBe(false);
    expect(upload.getAttribute("aria-disabled")).toBe("true");
    await press(screen, "secondary");
    expect(actions).toEqual(["consent-required", "consent-required"]);
    expect(screen.shadowRoot?.querySelector("sv-message")).toBeNull();
    screen.error = "Please accept consent.";
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe(
      "Please accept consent.",
    );
    screen.consented = true;
    screen.error = undefined;
    await screen.updateComplete;
    await press(screen, "primary");
    await press(screen, "secondary");
    expect(actions.slice(-2)).toEqual(["upload", "camera"]);
    expect(upload.hasAttribute("aria-disabled")).toBe(false);
  });

  it("offers upload and camera for returning shoppers without consent", async () => {
    const { screen, actions } = await mount({ consentRequired: false });
    expect(screen.shadowRoot?.querySelector("sv-checkbox")).toBeNull();
    expect(screen.shadowRoot?.querySelector(".withdrawal")).toBeNull();
    expect(screen.shadowRoot?.querySelector(".legal")).toBeNull();
    expect(screen.shadowRoot?.querySelector('[slot="secondary"]')).not.toBeNull();
    await press(screen, "primary");
    await press(screen, "secondary");
    expect(actions).toEqual(["upload", "camera"]);
    expect(screen.consented).toBe(false);
  });

  it("places consent validation above the actions while retaining the checkbox's error description", async () => {
    const { screen } = await mount();
    screen.setAttribute("consent-error", "Please accept consent.");
    await screen.updateComplete;
    const checkbox = await child(screen, "sv-checkbox");
    const box = nativeButton(checkbox);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toBe("field-error");
    expect(checkbox.shadowRoot!.querySelector("#field-error")!.textContent).toBe(
      "Please accept consent.",
    );
    expect(
      screen.shadowRoot!.querySelector('[slot="before-actions"] .errors sv-message')!.textContent,
    ).toBe("Please accept consent.");
    screen.consented = true;
    screen.removeAttribute("consent-error");
    await screen.updateComplete;
    await checkbox.updateComplete;
    expect(box.hasAttribute("aria-invalid")).toBe(false);
    expect(box.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.shadowRoot!.querySelector(".errors")).toBeNull();
  });

  it("requires consent by default and accepts an explicit false HTML attribute", async () => {
    const { screen, actions } = await mount();
    expect(screen.consentRequired).toBe(true);
    screen.setAttribute("consent-required", "false");
    await screen.updateComplete;
    expect(screen.consentRequired).toBe(false);
    expect(screen.shadowRoot?.querySelector("sv-checkbox")).toBeNull();
    expect(screen.shadowRoot?.querySelector('[slot="secondary"]')).not.toBeNull();
    const shell = await child(screen, "sv-screen");
    expect(shell.shadowRoot?.querySelector(".back")?.getAttribute("aria-label")).toBe("Back");
    expect(shell.shadowRoot?.querySelector(".close")?.getAttribute("aria-label")).toBe("Close");
    await press(screen, "primary");
    expect(actions).toEqual(["upload"]);

    screen.removeAttribute("consent-required");
    await screen.updateComplete;
    expect(screen.consentRequired).toBe(true);
    await shell.updateComplete;
    expect(shell.shadowRoot?.querySelector(".back")?.getAttribute("aria-label")).toBe("Back");
    expect(shell.shadowRoot?.querySelector(".close")?.getAttribute("aria-label")).toBe("Close");
    expect(screen.shadowRoot?.querySelector("sv-checkbox")).not.toBeNull();
    await press(screen, "secondary");
    expect(actions.at(-1)).toBe("consent-required");
  });

  it("locks actions, consent, and navigation while busy without inventing consent", async () => {
    const { screen, changes, actions } = await mount({ busy: true, consented: false });
    const checkbox = await child(screen, "sv-checkbox");
    expect(checkbox.checked).toBe(false);
    expect(nativeButton(checkbox).disabled).toBe(true);
    nativeButton(checkbox).click();
    const primary = await press(screen, "primary");
    const secondary = await press(screen, "secondary");
    expect(primary.disabled).toBe(true);
    expect(primary.getAttribute("aria-busy")).toBe("true");
    expect(secondary.disabled).toBe(true);
    const shell = await child(screen, "sv-screen");
    expect(shell.shadowRoot?.querySelector<HTMLButtonElement>(".back")?.disabled).toBe(true);
    expect(shell.shadowRoot?.querySelector<HTMLButtonElement>(".close")?.disabled).toBe(true);
    expect(changes).toEqual([]);
    expect(actions).toEqual([]);
    expect(screen.consented).toBe(false);
    const disclosure = await child(screen, "sv-disclosure", ".privacy");
    disclosure.shadowRoot?.querySelector("summary")?.click();
    expect(changes).toEqual([{ field: "photoFactsOpen", value: true }]);
    expect(screen.photoFactsOpen).toBe(false);
  });

  it("localizes content and renders legal links as structured text", async () => {
    const { screen, host } = await mount({ withdrawalOpen: true });
    const context = createUiContext({ locale: "de-CH" });
    const detach = context.attach(host);
    await context.ready();
    await screen.updateComplete;
    const shell = await child(screen, "sv-screen");
    expect(shell.heading).toBe("Bereit zur Anprobe?");
    expect(shell.shadowRoot?.querySelector(".back")?.getAttribute("aria-label")).toBe("Zurück");
    const guide = await child(screen, "sv-photo-guide");
    expect(guide.shadowRoot?.textContent).toContain("Natürliche");
    expect(
      screen.shadowRoot?.querySelector('a[href="https://studio-vaai.com/try-on/privacy"]')
        ?.textContent,
    ).toBe("Datenschutzerklärung");
    expect(
      screen.shadowRoot?.querySelector('a[href="https://studio-vaai.com/try-on/terms"]')
        ?.textContent,
    ).toBe("AGB");
    context.configure({
      messages: {
        "sessionIntro.sheetTitle": "Shop intro",
        "sessionIntro.legalFooter": "<img src=x onerror=alert(1)>",
        "surface.backSr": "Return",
        "surface.closeSr": "Dismiss",
      },
    });
    await screen.updateComplete;
    await shell.updateComplete;
    expect(shell.heading).toBe("Shop intro");
    expect(shell.shadowRoot?.querySelector(".back")?.getAttribute("aria-label")).toBe("Return");
    expect(shell.shadowRoot?.querySelector(".close")?.getAttribute("aria-label")).toBe("Dismiss");
    expect(screen.shadowRoot?.querySelector(".legal")?.textContent).toContain("<img");
    expect(screen.shadowRoot?.querySelector(".legal img")).toBeNull();
    detach();
  });
});
