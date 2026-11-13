// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SvAlertDialog, SvDialog, SvDismissDetail } from "../src/index.js";

import { defineSvElements } from "../src/index.js";

/**
 * jsdom has `<dialog>` but not the top layer: `showModal()` and `close()` are stubbed to toggle
 * `open` and fire `close` like a browser does, in a later task.
 */
function stubShowModal(this: HTMLDialogElement): void {
  this.setAttribute("open", "");
}

function stubClose(this: HTMLDialogElement): void {
  if (!this.hasAttribute("open")) {
    return;
  }
  this.removeAttribute("open");
  void Promise.resolve().then(() => this.dispatchEvent(new Event("close")));
}

/** jsdom has no `matchMedia`; `wide` stands for a viewport of 48em or more. */
function stubViewport(wide: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn<(query: string) => MediaQueryList>(
      (query) =>
        ({
          matches: wide,
          media: query,
          onchange: null,
          addEventListener: vi.fn<MediaQueryList["addEventListener"]>(),
          removeEventListener: vi.fn<MediaQueryList["removeEventListener"]>(),
          dispatchEvent: vi.fn<MediaQueryList["dispatchEvent"]>(),
          // The deprecated listener methods are never called; jsdom's type still lists them.
        }) as unknown as MediaQueryList,
    ),
  );
}

async function mountDialog(attributes: Record<string, string> = {}): Promise<SvDialog> {
  const el = document.createElement("sv-dialog");
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }
  el.innerHTML = `<div class="content"><p>Your height</p><button data-sv-dismiss>Close</button></div>`;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

async function mountAlert(): Promise<SvAlertDialog> {
  const el = document.createElement("sv-alert-dialog");
  el.heading = "Retake your photo?";
  el.description = "Your current photo and its try-ons are discarded.";
  el.confirmLabel = "Retake photo";
  el.cancelLabel = "Keep this photo";
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function panel(el: Element): HTMLDialogElement {
  const found = el.shadowRoot?.querySelector("dialog");
  if (!found) {
    throw new Error("dialog not rendered");
  }
  return found;
}

function dismissReasons(el: SvDialog): SvDismissDetail["reason"][] {
  const reasons: SvDismissDetail["reason"][] = [];
  el.addEventListener("sv-dismiss", (event) => {
    reasons.push(event.detail.reason);
  });
  return reasons;
}

/** Let pending promises run: the exit, the stub's `close` event, a reopen. */
async function settle(): Promise<void> {
  await delay(0);
}

/**
 * jsdom has no `getAnimations()`, so a dialog closes right away. This gives the box one running
 * exit transition and returns the function that ends it.
 */
function holdExit(dialog: HTMLDialogElement): () => void {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  const transition = { effect: null, finished: promise } as unknown as Animation;
  dialog.getAnimations = () => [transition];
  return () => {
    resolve(globalThis.undefined);
  };
}

function pressEscape(dialog: HTMLDialogElement): Event {
  const event = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(event);
  return event;
}

describe("overlays", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = stubShowModal;
    HTMLDialogElement.prototype.close = stubClose;
    defineSvElements();
  });

  beforeEach(() => {
    stubViewport(true);
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute("style");
  });

  describe("sv-dialog", () => {
    it("opens in the top layer when `open` is set, named by `label`", async () => {
      const el = await mountDialog({ label: "Your height" });
      expect(panel(el).open).toBe(false);
      el.open = true;
      await el.updateComplete;
      expect(panel(el).open).toBe(true);
      expect(panel(el).getAttribute("aria-label")).toBe("Your height");
      expect(document.documentElement.style.overflow).toBe("hidden");
    });

    it("closes once the exit transition has finished, then gives the page its scroll back", async () => {
      const el = await mountDialog({ open: "" });
      const endExit = holdExit(panel(el));
      el.open = false;
      await el.updateComplete;
      await settle();
      expect(panel(el).open).toBe(true);
      expect(panel(el).dataset.closing).toBe("");
      endExit();
      await settle();
      expect(panel(el).open).toBe(false);
      expect(document.documentElement.style.overflow).toBe("");
    });

    it("stays open when opened again during its exit", async () => {
      const el = await mountDialog({ open: "" });
      const endExit = holdExit(panel(el));
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await el.updateComplete;
      expect(panel(el).dataset.closing).toBeUndefined();
      endExit();
      await settle();
      expect(panel(el).open).toBe(true);
      expect(document.documentElement.style.overflow).toBe("hidden");
    });

    it("asks to close on Esc and stays open until the owner answers", async () => {
      const el = await mountDialog({ open: "" });
      const reasons = dismissReasons(el);
      const event = pressEscape(panel(el));
      expect(event.defaultPrevented).toBe(true);
      expect(reasons).toEqual(["escape"]);
      expect(panel(el).open).toBe(true);
    });

    it("asks to close on a click outside the box, not inside it", async () => {
      const el = await mountDialog({ open: "" });
      const reasons = dismissReasons(el);
      el.querySelector("p")?.click();
      expect(reasons).toEqual([]);
      panel(el).dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, clientX: 20, clientY: 20 }),
      );
      expect(reasons).toEqual(["backdrop"]);
    });

    it("turns a press on a `data-sv-dismiss` element into a close request", async () => {
      const el = await mountDialog({ open: "" });
      const reasons = dismissReasons(el);
      el.querySelector("button")?.click();
      expect(reasons).toEqual(["close-button"]);
    });

    it("ignores Esc and the backdrop while persistent, but not a close button", async () => {
      const el = await mountDialog({ open: "", persistent: "" });
      const reasons = dismissReasons(el);
      pressEscape(panel(el));
      panel(el).dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, clientX: 20, clientY: 20 }),
      );
      el.querySelector("button")?.click();
      expect(reasons).toEqual(["close-button"]);
    });

    it("is a drawer on narrow viewports and a dialog on wide ones", async () => {
      stubViewport(false);
      const narrow = await mountDialog();
      expect(narrow.resolvedShape).toBe("drawer");
      expect(panel(narrow).dataset.shape).toBe("drawer");
      stubViewport(true);
      const wide = await mountDialog();
      expect(wide.resolvedShape).toBe("dialog");
    });

    it("reports a close the browser forced and reopens while the owner says open", async () => {
      const el = await mountDialog({ open: "" });
      const reasons = dismissReasons(el);
      HTMLDialogElement.prototype.close.call(panel(el));
      await settle();
      expect(reasons).toEqual(["escape"]);
      expect(panel(el).open).toBe(true);
      expect(document.documentElement.style.overflow).toBe("hidden");
    });

    it("does not mistake its own close for one the browser forced", async () => {
      const el = await mountDialog({ open: "" });
      const reasons = dismissReasons(el);
      el.open = false;
      await el.updateComplete;
      await settle();
      expect(reasons).toEqual([]);
      expect(panel(el).open).toBe(false);
    });
  });

  describe("sv-alert-dialog", () => {
    it("is an alert dialog named and described by its texts", async () => {
      const el = await mountAlert();
      const dialog = panel(el);
      expect(dialog.getAttribute("role")).toBe("alertdialog");
      const heading = el.shadowRoot?.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
      expect(heading?.textContent).toBe("Retake your photo?");
    });

    it("fires sv-confirm and sv-cancel, and Esc cancels", async () => {
      const el = await mountAlert();
      el.open = true;
      await el.updateComplete;
      const fired: string[] = [];
      el.addEventListener("sv-confirm", () => fired.push("confirm"));
      el.addEventListener("sv-cancel", (event) => fired.push(`cancel:${event.detail.reason}`));
      el.shadowRoot?.querySelector<HTMLElement>(".confirm")?.click();
      el.shadowRoot?.querySelector<HTMLElement>(".cancel")?.click();
      pressEscape(panel(el));
      expect(fired).toEqual(["confirm", "cancel:button", "cancel:escape"]);
      expect(panel(el).open).toBe(true);
    });

    it("offers cancel as the text action and confirm as the primary", async () => {
      const el = await mountAlert();
      expect(el.shadowRoot?.querySelector(".cancel")?.getAttribute("variant")).toBe("ghost");
      expect(el.shadowRoot?.querySelector(".confirm")?.hasAttribute("variant")).toBe(false);
    });

    it("keeps the page locked while the flow under it is still open", async () => {
      const flow = await mountDialog({ open: "" });
      const alert = await mountAlert();
      alert.open = true;
      await alert.updateComplete;
      alert.open = false;
      await alert.updateComplete;
      await settle();
      expect(panel(alert).open).toBe(false);
      expect(document.documentElement.style.overflow).toBe("hidden");
      flow.open = false;
      await flow.updateComplete;
      await settle();
      expect(document.documentElement.style.overflow).toBe("");
    });
  });
});
