// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { SvPhotoRetakeActionDetail } from "../src/screens/sv-photo-retake-dialog.js";

import { createUiContext, defineSvElements } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

/** JSDOM has no native modal API; stub only the dialog instance under test. */
async function mount(open = false) {
  const host = document.createElement("div");
  const confirmation = document.createElement("sv-photo-retake-dialog");
  host.append(confirmation);
  document.body.append(host);
  await confirmation.updateComplete;
  const alert = confirmation.shadowRoot?.querySelector("sv-alert-dialog");
  if (!alert) {
    throw new Error("Missing alert dialog");
  }
  await alert.updateComplete;
  const dialog = alert.shadowRoot?.querySelector("dialog");
  if (!dialog) {
    throw new Error("Missing native dialog");
  }
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(new Event("close"));
  };
  const actions: SvPhotoRetakeActionDetail[] = [];
  host.addEventListener("sv-photo-retake-action", (event) => {
    actions.push(event.detail);
  });
  confirmation.open = open;
  await confirmation.updateComplete;
  await alert.updateComplete;
  return { host, confirmation, alert, dialog, actions };
}

async function press(
  alert: HTMLElementTagNameMap["sv-alert-dialog"],
  selector: ".confirm" | ".cancel",
) {
  const button = alert.shadowRoot?.querySelector<HTMLElementTagNameMap["sv-button"]>(selector);
  if (!button) {
    throw new Error("Missing action button");
  }
  await button.updateComplete;
  button.shadowRoot?.querySelector("button")?.click();
}

describe("stateless photo retake confirmation", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("maps the shared catalog to the existing alert dialog", async () => {
    const { confirmation, alert, dialog } = await mount();
    expect(confirmation.open).toBe(false);
    expect(alert.open).toBe(false);
    expect(dialog.open).toBe(false);
    expect(alert.heading).toBe("Record another photo?");
    expect(alert.description).toContain("Your current photo will be deleted");
    expect(alert.confirmLabel).toBe("Continue");
    expect(alert.cancelLabel).toBe("Cancel");
    expect(dialog.getAttribute("role")).toBe("alertdialog");
  });

  it("requests retake once without closing itself or leaking the primitive's event", async () => {
    const { host, confirmation, alert, dialog, actions } = await mount(true);
    let rawConfirms = 0;
    host.addEventListener("sv-confirm", () => {
      rawConfirms += 1;
    });
    await press(alert, ".confirm");
    expect(actions).toEqual([{ action: "retake" }]);
    expect(rawConfirms).toBe(0);
    expect(confirmation.open).toBe(true);
    expect(alert.open).toBe(true);
    expect(dialog.open).toBe(true);
    confirmation.open = false;
    await confirmation.updateComplete;
    await alert.updateComplete;
    expect(alert.open).toBe(false);
    expect(actions).toHaveLength(1);
  });

  it("preserves button and Escape cancellation reasons without closing", async () => {
    const { host, confirmation, alert, dialog, actions } = await mount(true);
    let rawCancels = 0;
    host.addEventListener("sv-cancel", () => {
      rawCancels += 1;
    });
    await press(alert, ".cancel");
    const escape = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(actions).toEqual([
      { action: "cancel", reason: "button" },
      { action: "cancel", reason: "escape" },
    ]);
    expect(rawCancels).toBe(0);
    expect(confirmation.open).toBe(true);
    expect(dialog.open).toBe(true);
  });

  it("ignores stale primitive requests once the host has closed it", async () => {
    const { alert, actions } = await mount();
    alert.dispatchEvent(new CustomEvent("sv-confirm", { bubbles: true, composed: true }));
    alert.dispatchEvent(
      new CustomEvent("sv-cancel", {
        detail: { reason: "button" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(actions).toEqual([]);
  });

  it("updates locale and appearance in place without changing visibility", async () => {
    const { host, confirmation, alert, dialog } = await mount(true);
    const context = createUiContext();
    const detach = context.attach(host);
    await context.ready();
    context.configure({ locale: "de", appearance: "dark" });
    await confirmation.updateComplete;
    await alert.updateComplete;
    expect(alert.heading).toBe("Neues Foto aufnehmen?");
    expect(alert.confirmLabel).toBe("Weiter");
    expect(alert.cancelLabel).toBe("Abbrechen");
    expect(alert.dataset.svAppearance).toBe("dark");
    expect(confirmation.open).toBe(true);
    expect(dialog.open).toBe(true);
    detach();
  });
});
