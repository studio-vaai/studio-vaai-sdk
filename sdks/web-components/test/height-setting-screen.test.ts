// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  SvHeightSettingActionDetail,
  SvHeightSettingChangeDetail,
  SvHeightSettingScreenProps,
} from "../src/screens/sv-height-setting-screen.js";

import { defineSvElements, createUiContext } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

async function mount(props: Partial<SvHeightSettingScreenProps> = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("sv-height-setting-screen");
  Object.assign(screen, props);
  host.append(screen);
  document.body.append(host);
  await screen.updateComplete;
  const changes: SvHeightSettingChangeDetail[] = [];
  const actions: SvHeightSettingActionDetail["action"][] = [];
  host.addEventListener("sv-height-setting-change", (event) => {
    changes.push(event.detail);
  });
  host.addEventListener("sv-height-setting-action", (event) => {
    actions.push(event.detail.action);
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
  const button = el.shadowRoot?.querySelector("button");
  if (!button) {
    throw new Error("Missing native button");
  }
  button.click();
  return button;
}

describe("stateless height setting", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 139, 221, 170.5])(
    "requires a valid host-supplied height before rendering the input or confirming: %s",
    async (heightCm) => {
      const { screen, actions } = await mount({ heightCm });
      expect(screen.heightCm).toBe(heightCm);
      expect(screen.shadowRoot?.querySelector("sv-height-input")).toBeNull();
      const primary = await press(screen, "primary");
      expect(primary.disabled).toBe(true);
      primary.dispatchEvent(new Event("click"));
      expect(actions).toEqual([]);
      await press(screen, "secondary");
      expect(actions).toEqual(["upload"]);

      screen.heightCm = 180;
      await screen.updateComplete;
      const input = await child(screen, "sv-height-input");
      expect(input.value).toBe(180);
      await press(screen, "primary");
      expect(actions).toEqual(["upload", "confirm"]);
    },
  );

  it("requests height changes without accepting them or leaking the primitive event", async () => {
    const { screen, host, changes } = await mount({ heightCm: 178 });
    const input = await child(screen, "sv-height-input");
    input.mode = "stepper";
    await input.updateComplete;
    const leaked: unknown[] = [];
    host.addEventListener("sv-change", (event) => {
      leaked.push(event.detail);
    });
    input.shadowRoot?.querySelector<HTMLButtonElement>(".step")?.click();
    await screen.updateComplete;
    expect(changes).toEqual([{ field: "heightCm", value: 179 }]);
    expect(leaked).toEqual([]);
    expect(screen.heightCm).toBe(178);
    expect(input.value).toBe(178);
    expect(screen.error).toBeUndefined();
    screen.heightCm = 179;
    await screen.updateComplete;
    await input.updateComplete;
    expect(input.value).toBe(179);
  });

  it("requests confirmation and another photo without changing host inputs", async () => {
    const { screen, actions } = await mount({
      heightCm: 180,
      photoSrc: "/photo.jpg",
      error: "Try again",
    });
    await press(screen, "primary");
    await press(screen, "secondary");
    expect(actions).toEqual(["confirm", "upload"]);
    expect(screen.heightCm).toBe(180);
    expect(screen.photoSrc).toBe("/photo.jpg");
    expect(screen.error).toBe("Try again");
    expect(screen.busy).toBe(false);
  });

  it("keeps the photo crop and error controlled by the host", async () => {
    const crop = { cx: 0.5, cy: 0.5, width: 0.75, height: 1 };
    const { screen } = await mount({
      photoSrc: "/captured.jpg",
      photoCrop: crop,
      error: "Save failed",
    });
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("/captured.jpg");
    expect(image.crop).toBe(crop);
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe("Save failed");
    screen.error = "";
    screen.photoCrop = undefined;
    screen.photoSrc = "/other.jpg";
    await screen.updateComplete;
    await image.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")).toBeNull();
    expect(image.crop).toBeUndefined();
    expect(image.src).toBe("/other.jpg");
  });

  it("locks the input, actions and navigation while busy and ignores synthetic changes", async () => {
    const { screen, changes, actions } = await mount({ busy: true, heightCm: 178 });
    const input = await child(screen, "sv-height-input");
    const shell = await child(screen, "sv-screen");
    expect(input.disabled).toBe(true);
    expect(shell.busy).toBe(true);
    expect(shell.shadowRoot?.querySelector<HTMLButtonElement>(".back")?.disabled).toBe(true);
    expect(shell.shadowRoot?.querySelector<HTMLButtonElement>(".close")?.disabled).toBe(true);
    const primary = await press(screen, "primary");
    const secondary = await press(screen, "secondary");
    expect(primary.disabled).toBe(true);
    expect(primary.getAttribute("aria-busy")).toBe("true");
    expect(secondary.disabled).toBe(true);
    input.dispatchEvent(
      new CustomEvent("sv-change", { detail: { value: 185 }, bubbles: true, composed: true }),
    );
    expect(changes).toEqual([]);
    expect(actions).toEqual([]);
    expect(screen.heightCm).toBe(178);
    await vi.waitFor(() => {
      expect(shell.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("Saving height");
    });
  });

  it("updates localized names and appearance without resetting height or custom error text", async () => {
    const { screen, host } = await mount({
      heightCm: 182,
      photoSrc: "/photo.jpg",
      error: "Host error",
    });
    const context = createUiContext();
    const detach = context.attach(host);
    await context.ready();
    context.configure({ locale: "de", appearance: "dark" });
    await screen.updateComplete;
    const shell = await child(screen, "sv-screen");
    const input = await child(screen, "sv-height-input");
    expect(shell.heading).toBe("Körpergröße angeben");
    expect(input.label).toBe("Wie groß bist du?");
    expect(input.value).toBe(182);
    expect(screen.heightCm).toBe(182);
    expect(screen.error).toBe("Host error");
    expect(screen.dataset.svAppearance).toBe("dark");
    const button = await child(screen, "sv-button", '[slot="primary"]');
    expect(button.textContent).toBe("Weiter zur Anprobe");
    detach();
  });
});
