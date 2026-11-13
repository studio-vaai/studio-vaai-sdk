import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Collapsing controls expose their resting geometry without changing their open state. */
export const panelRestingSize = Symbol("panelRestingSize");

export interface PanelRestingMeasurement {
  blockSize: number;
  /** Intrinsic nodes whose size can change independently of the open control's outer box. */
  targets: readonly HTMLElement[];
}

interface RestingControl extends HTMLElement {
  [panelRestingSize](): PanelRestingMeasurement;
}

const RESTING_SIZE_EVENT = "sv-panel-resting-size";

export function notifyPanelRestingSize(element: HTMLElement): void {
  element.dispatchEvent(new Event(RESTING_SIZE_EVENT, { bubbles: true, composed: true }));
}

function pixels(value: string): number {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function blockEdges(style: CSSStyleDeclaration): number {
  return (
    pixels(style.paddingBlockStart) +
    pixels(style.paddingBlockEnd) +
    pixels(style.borderBlockStartWidth) +
    pixels(style.borderBlockEndWidth)
  );
}

/** CSS layout size, unaffected by a dialog's entering transform or a preview's scale. */
export function measuredBlockSize(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const size = Number.parseFloat(style.blockSize || style.height);
  return Number.isFinite(size)
    ? size + (style.boxSizing === "border-box" ? 0 : blockEdges(style))
    : element.offsetHeight;
}

function isRestingControl(element: HTMLElement): element is RestingControl {
  return panelRestingSize in element;
}

/** Measure the panel's ordinary stacks, substituting each disclosure's resting size. */
export function measureRestingPanel(elements: readonly HTMLElement[]): PanelRestingMeasurement {
  const targets = new Set<HTMLElement>();
  // Overlay controls participate in the visible stack, but never shrink the photo's budget.
  const participates = (element: HTMLElement): boolean =>
    !Object.hasOwn(element.dataset, "svPanelOverlay") &&
    getComputedStyle(element).display !== "none";
  function measureIntrinsic(element: HTMLElement): number {
    targets.add(element);
    return measuredBlockSize(element);
  }
  function measure(element: HTMLElement): number {
    const style = getComputedStyle(element);
    if (!participates(element)) {
      return 0;
    }
    if (isRestingControl(element)) {
      const resting = element[panelRestingSize]();
      for (const target of resting.targets) {
        targets.add(target);
      }
      return resting.blockSize;
    }
    if (element instanceof HTMLSlotElement) {
      return stack(
        element
          .assignedElements({ flatten: true })
          .filter((child): child is HTMLElement => child instanceof HTMLElement),
      );
    }
    // Other custom elements own their internals. Their actual size is their resting size.
    if (element.shadowRoot !== null) {
      return measureIntrinsic(element);
    }
    const elements = [...element.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const hasText = [...element.childNodes].some(
      (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
    );
    if (elements.length === 0 || hasText) {
      return Math.max(pixels(style.minBlockSize), measureIntrinsic(element));
    }
    const children = elements.filter((child) => participates(child));
    if (children.length === 0) {
      return Math.max(pixels(style.minBlockSize), blockEdges(style));
    }
    if (style.display === "flex" || style.display === "inline-flex") {
      const column = style.flexDirection.startsWith("column");
      if (!column && (style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse")) {
        // Wrapped toolbar rows can take several lines even while their parent is folded away.
        return measureIntrinsic(element);
      }
      const size = column
        ? stack(children, pixels(style.rowGap))
        : Math.max(...children.map((child) => outerSize(child)));
      return Math.max(pixels(style.minBlockSize), size + blockEdges(style));
    }
    if (style.display === "grid" || style.display === "inline-grid") {
      // A multi-column grid has its own track sizing; it is an atomic panel item.
      if (style.gridTemplateColumns.trim().split(/\s+/u).length > 1) {
        return measureIntrinsic(element);
      }
      return Math.max(
        pixels(style.minBlockSize),
        stack(children, pixels(style.rowGap)) + blockEdges(style),
      );
    }
    return stack(children) + blockEdges(style);
  }
  function outerSize(element: HTMLElement): number {
    const style = getComputedStyle(element);
    return measure(element) + pixels(style.marginBlockStart) + pixels(style.marginBlockEnd);
  }
  function stack(children: readonly HTMLElement[], gap = 0): number {
    const visible = children.filter((child) => participates(child));
    return (
      visible.reduce((sum, child) => sum + outerSize(child), 0) +
      Math.max(0, visible.length - 1) * gap
    );
  }
  return { blockSize: Math.max(0, stack(elements)), targets: [...targets] };
}

interface PanelLayoutHost extends ReactiveControllerHost, HTMLElement {
  readonly renderRoot: HTMLElement | DocumentFragment;
  readonly panelMode: string;
}

/** Watches only the panel and its intrinsic resting nodes, never the image it sizes. */
export class PanelLayoutController implements ReactiveController {
  readonly #host: PanelLayoutHost;
  #resize: ResizeObserver | undefined;
  #mutation: MutationObserver | undefined;
  #targets = new Set<HTMLElement>();
  #queued = false;
  #connected = false;
  #size: number | undefined;

  constructor(host: PanelLayoutHost) {
    this.#host = host;
  }

  hostConnected(): void {
    this.#connected = true;
    if (typeof ResizeObserver !== "undefined") {
      this.#resize = new ResizeObserver(this.#schedule);
    }
    this.#mutation = new MutationObserver(this.#schedule);
    this.#mutation.observe(this.#host, {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true,
    });
    this.#host.addEventListener(RESTING_SIZE_EVENT, this.#schedule);
    this.#host.addEventListener("slotchange", this.#schedule);
    this.#schedule();
  }

  hostDisconnected(): void {
    this.#connected = false;
    this.#resize?.disconnect();
    this.#mutation?.disconnect();
    this.#targets.clear();
    this.#host.removeEventListener(RESTING_SIZE_EVENT, this.#schedule);
    this.#host.removeEventListener("slotchange", this.#schedule);
  }

  hostUpdated(): void {
    this.#schedule();
  }

  readonly #schedule = (): void => {
    if (this.#queued || !this.#connected) {
      return;
    }
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (this.#connected) {
        this.#measure();
      }
    });
  };

  #measure(): void {
    const body = this.#host.renderRoot.querySelector<HTMLElement>(".body");
    const content = this.#host.renderRoot.querySelector<HTMLElement>(".panel-content");
    const slot = content?.querySelector<HTMLSlotElement>("slot");
    if (body === null || content === null || content === undefined || !slot) {
      return;
    }
    const measurement =
      this.#host.panelMode === "overlay"
        ? measureRestingPanel(
            slot
              .assignedElements({ flatten: true })
              .filter((child): child is HTMLElement => child instanceof HTMLElement),
          )
        : { blockSize: 0, targets: [] };
    // The body changes with the available space. The panel content also changes on every
    // animation frame, even when none of its resting measurements have changed.
    const targets = new Set(
      this.#host.panelMode === "overlay" ? [body, ...measurement.targets] : [],
    );
    for (const target of this.#targets) {
      if (!targets.has(target)) {
        this.#resize?.unobserve(target);
      }
    }
    for (const target of targets) {
      if (!this.#targets.has(target)) {
        this.#resize?.observe(target);
      }
    }
    this.#targets = targets;
    if (this.#size !== measurement.blockSize) {
      this.#size = measurement.blockSize;
      body.style.setProperty("--_sv-panel-resting-size", `${String(measurement.blockSize)}px`);
    }
  }
}
