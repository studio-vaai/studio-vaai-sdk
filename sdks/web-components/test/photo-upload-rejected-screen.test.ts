// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  SvPhotoUploadRejectedActionDetail,
  SvPhotoUploadRejectedScreenProps,
} from "../src/index.js";

import { createUiContext, defineSvElements } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

async function mount(props: SvPhotoUploadRejectedScreenProps = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("sv-photo-upload-rejected-screen");
  Object.assign(screen, props);
  host.append(screen);
  document.body.append(host);
  await screen.updateComplete;
  const actions: SvPhotoUploadRejectedActionDetail["action"][] = [];
  host.addEventListener("sv-photo-upload-rejected-action", (event) => {
    actions.push(event.detail.action);
  });
  return { host, screen, actions };
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

describe("stateless photo rejected", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("preserves the host's photo and camera crop and renders one inline failure", async () => {
    const crop = { cx: 0.5, cy: 0.5, width: 0.75, height: 1 };
    const { screen } = await mount({ photoSrc: "blob:rejected-photo", photoCrop: crop });
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("blob:rejected-photo");
    expect(image.crop).toBe(crop);
    expect(screen.shadowRoot?.querySelectorAll("sv-message")).toHaveLength(1);
    const message = await child(screen, "sv-message");
    expect(message.layout).toBeUndefined();
    expect(message.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull();
    expect(message.textContent).toContain("This photo could not be processed");
    const shell = await child(screen, "sv-screen");
    expect(shell.heading).toBe("Different photo needed");
    expect(shell.shadowRoot?.querySelector('h2 slot[name="heading"]')).not.toBeNull();
  });

  it("requests upload and guide without replacing the photo or navigating itself", async () => {
    const { screen, actions } = await mount({ photoSrc: "/rejected.jpg", error: "Host rejection" });
    await press(screen, "primary");
    await press(screen, "secondary");
    expect(actions).toEqual(["upload", "guide"]);
    expect(screen.photoSrc).toBe("/rejected.jpg");
    expect(screen.error).toBe("Host rejection");
    expect(screen.busy).toBe(false);
    expect(screen.shadowRoot?.querySelector("sv-session-intro-screen")).toBeNull();
  });

  it("locks actions and navigation while busy, then restores the same host error", async () => {
    const { screen, actions } = await mount({
      busy: true,
      error: "Host rejection",
      photoSrc: "/rejected.jpg",
    });
    const shell = await child(screen, "sv-screen");
    expect(shell.busy).toBe(true);
    expect(shell.shadowRoot?.querySelector<HTMLButtonElement>(".back")?.disabled).toBe(true);
    expect(shell.shadowRoot?.querySelector<HTMLButtonElement>(".close")?.disabled).toBe(true);
    const upload = await press(screen, "primary");
    expect(upload.busy).toBe(true);
    await press(screen, "secondary");
    upload.click();
    expect(actions).toEqual([]);
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe("Host rejection");
    await vi.waitFor(() => {
      expect(shell.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("Uploading");
    });
    screen.busy = false;
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe("Host rejection");
    expect(screen.error).toBe("Host rejection");
    expect(screen.photoSrc).toBe("/rejected.jpg");
    await press(screen, "primary");
    expect(actions).toEqual(["upload"]);
  });

  it("treats host error text as text and uses the catalog again when cleared", async () => {
    const { screen } = await mount({ error: "<img src=x onerror=alert(1)>" });
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(screen.shadowRoot?.querySelector("sv-message img")).toBeNull();
    screen.error = "";
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")).toBeNull();
    screen.error = undefined;
    await screen.updateComplete;
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toContain(
      "This photo could not be processed",
    );
  });

  it("updates catalog copy and appearance without changing photo, crop, or host error", async () => {
    const crop = { cx: 0.5, cy: 0.5, width: 1, height: 0.6 };
    const { host, screen } = await mount({ photoSrc: "/rejected.jpg", photoCrop: crop });
    const ui = createUiContext();
    const detach = ui.attach(host);
    await ui.ready();
    ui.configure({ locale: "de", appearance: "dark" });
    await screen.updateComplete;
    const shell = await child(screen, "sv-screen");
    expect(shell.heading).toBe("Bitte nimm ein anderes Foto");
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toContain(
      "Mit diesem Foto klappt es leider nicht",
    );
    const upload = await child(screen, "sv-button", '[slot="primary"]');
    expect(upload.textContent).toBe("Anderes Foto verwenden");
    expect(screen.photoSrc).toBe("/rejected.jpg");
    expect(screen.photoCrop).toBe(crop);
    expect(screen.dataset.svAppearance).toBe("dark");
    screen.error = "Host-localized copy";
    await screen.updateComplete;
    ui.configure({ locale: "en" });
    await screen.updateComplete;
    expect(screen.error).toBe("Host-localized copy");
    expect(screen.shadowRoot?.querySelector("sv-message")?.textContent).toBe("Host-localized copy");
    detach();
  });
});
