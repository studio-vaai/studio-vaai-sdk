// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defineSvElements } from "../src/index.js";
import { measureRestingPanel, notifyPanelRestingSize } from "../src/internal/panel-layout.js";
import { initializeTestUi } from "./ui-fixture.js";

async function disclosure() {
  const element = document.createElement("sv-disclosure");
  element.heading = "Try another variant";
  element.textContent = "Expanded choices";
  document.body.append(element);
  await element.updateComplete;
  const summary = element.shadowRoot!.querySelector<HTMLElement>("summary")!;
  summary.style.height = "36px";
  summary.style.boxSizing = "border-box";
  return { element, summary };
}

async function score() {
  const element = document.createElement("sv-fit-score");
  element.description = "A longer intended-fit description.";
  document.body.append(element);
  await element.updateComplete;
  const bar = element.shadowRoot!.querySelector<HTMLElement>(".bar")!;
  const label = element.shadowRoot!.querySelector<HTMLElement>(".label")!;
  bar.style.paddingBlockStart = "10px";
  bar.style.paddingBlockEnd = "10px";
  label.style.height = "17.5px";
  label.style.boxSizing = "border-box";
  return { element, bar };
}

describe("resting panel layout", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("measures a disclosure's summary independently of its open content", async () => {
    const { element, summary } = await disclosure();
    expect(measureRestingPanel([element]).blockSize).toBe(36);
    element.open = true;
    await element.updateComplete;
    element.style.height = "240px";
    expect(measureRestingPanel([element]).blockSize).toBe(36);
    summary.style.height = "44px";
    expect(measureRestingPanel([element]).blockSize).toBe(44);
    expect(element.open).toBe(true);
    expect(measureRestingPanel([element]).targets).toContain(summary);
  });

  it("includes stack gaps and hidden resting rows but omits absent rows", async () => {
    const panel = document.createElement("div");
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.rowGap = "16px";
    const history = document.createElement("div");
    history.style.height = "28px";
    history.style.visibility = "hidden";
    const fit = await score();
    const picker = await disclosure();
    panel.append(history, fit.element, picker.element);
    document.body.append(panel);
    expect(measureRestingPanel([panel]).blockSize).toBe(133.5);
    history.style.display = "none";
    expect(measureRestingPanel([panel]).blockSize).toBe(89.5);
  });

  it("reserves a folded history's natural height while excluding overlay controls and their seams", async () => {
    const panel = document.createElement("div");
    panel.style.cssText = "display:flex;flex-direction:column;row-gap:20px";
    const fold = document.createElement("div");
    fold.style.cssText = "display:grid;grid-template-rows:0fr;opacity:0";
    const clip = document.createElement("div");
    clip.style.cssText = "min-height:0;overflow:hidden";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;min-block-size:36px;height:0";
    clip.append(row);
    fold.append(clip);
    const fit = await score();
    const picker = await disclosure();
    fit.element.dataset.svPanelOverlay = "";
    picker.element.dataset.svPanelOverlay = "";
    panel.append(fold, fit.element, picker.element);
    document.body.append(panel);
    expect(measureRestingPanel([panel]).blockSize).toBe(36);
    fold.style.gridTemplateRows = "1fr";
    picker.element.open = true;
    fit.element.open = true;
    await Promise.all([picker.element.updateComplete, fit.element.updateComplete]);
    expect(measureRestingPanel([panel]).blockSize).toBe(36);
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;flex-wrap:wrap;height:64px";
    for (let index = 0; index < 2; index += 1) {
      const choice = document.createElement("div");
      choice.style.height = "28px";
      toolbar.append(choice);
    }
    row.append(toolbar);
    expect(measureRestingPanel([panel]).blockSize).toBe(64);
    expect(measureRestingPanel([panel]).targets).toContain(toolbar);
    fold.remove();
    panel.style.height = "240px";
    expect(measureRestingPanel([panel]).blockSize).toBe(0);
  });

  it("retains the panel budget across open changes and updates it from intrinsic resize", async () => {
    const callbacks: (() => void)[] = [];
    const observed: HTMLElement[] = [];
    const disconnect = vi.fn<() => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(onResize: () => void) {
          callbacks.push(onResize);
        }
        observe = vi.fn<(target: HTMLElement) => void>((target) => {
          observed.push(target);
        });
        unobserve = vi.fn<() => void>();
        disconnect = disconnect;
      },
    );
    const { element, summary } = await disclosure();
    const screen = document.createElement("sv-screen");
    screen.panelMode = "overlay";
    screen.append(element);
    document.body.append(screen);
    await screen.updateComplete;
    await Promise.resolve();
    const body = screen.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("36px");
    expect(observed).toContain(summary);
    expect(observed).not.toContain(element);
    expect(observed).not.toContain(screen.shadowRoot!.querySelector(".panel-content"));
    element.open = true;
    await element.updateComplete;
    await Promise.resolve();
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("36px");
    summary.style.height = "44px";
    callbacks.at(0)?.();
    await Promise.resolve();
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("44px");
    expect(element.open).toBe(true);
    screen.remove();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("updates the image budget as the fit score expands and collapses below the history", async () => {
    const observed = new Map<Element, () => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly onResize: () => void;
        constructor(onResize: () => void) {
          this.onResize = onResize;
        }
        observe = vi.fn<(target: Element) => void>((target) => {
          observed.set(target, this.onResize);
        });
        unobserve = vi.fn<(target: Element) => void>();
        disconnect = vi.fn<() => void>();
      },
    );
    const { element: fit, bar } = await score();
    const history = document.createElement("div");
    history.style.height = "30px";
    const panel = document.createElement("div");
    panel.style.cssText = "display:flex;flex-direction:column;row-gap:16px";
    panel.append(history, fit);
    const screen = document.createElement("sv-screen");
    screen.panelMode = "overlay";
    screen.append(panel);
    document.body.append(screen);
    await screen.updateComplete;
    const body = screen.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const budget = () => body.style.getPropertyValue("--_sv-panel-resting-size");
    expect(budget()).toBe("83.5px");
    expect(observed.has(bar)).toBe(true);

    fit.open = true;
    await fit.updateComplete;
    bar.style.boxSizing = "border-box";
    bar.style.height = "62px";
    observed.get(bar)?.();
    await Promise.resolve();
    expect(budget()).toBe("108px");

    fit.open = false;
    await fit.updateComplete;
    bar.style.height = "37.5px";
    observed.get(bar)?.();
    await Promise.resolve();
    expect(budget()).toBe("83.5px");
  });

  it("recomputes an initially expanded panel without needing a collapsed measurement", async () => {
    const { element, summary } = await disclosure();
    element.open = true;
    await element.updateComplete;
    const screen = document.createElement("sv-screen");
    screen.panelMode = "overlay";
    screen.append(element);
    document.body.append(screen);
    await screen.updateComplete;
    await Promise.resolve();
    const body = screen.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("36px");
    summary.style.height = "48px";
    notifyPanelRestingSize(element);
    await Promise.resolve();
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("48px");
    expect(element.open).toBe(true);
  });

  it("reserves a resting budget only in overlay mode", async () => {
    const { element, summary } = await disclosure();
    const screen = document.createElement("sv-screen");
    screen.append(element);
    document.body.append(screen);
    await screen.updateComplete;
    await Promise.resolve();
    const body = screen.shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(screen.panelMode).toBe("stack");
    expect(screen.getAttribute("panel-mode")).toBe("stack");
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("0px");
    screen.panelMode = "overlay";
    await screen.updateComplete;
    await Promise.resolve();
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("36px");
    screen.panelMode = "backdrop";
    await screen.updateComplete;
    await Promise.resolve();
    expect(screen.getAttribute("panel-mode")).toBe("backdrop");
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("0px");
    summary.style.height = "48px";
    notifyPanelRestingSize(element);
    await Promise.resolve();
    expect(body.style.getPropertyValue("--_sv-panel-resting-size")).toBe("0px");
  });
});
