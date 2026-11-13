import type { ReactiveController, ReactiveControllerHost } from "lit";

import { placeFitCallouts } from "./callout-layout.js";

type CalloutHost = ReactiveControllerHost & { readonly renderRoot: HTMLElement | DocumentFragment };

function number(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Measures the fitted image and the localized cards without adding screen state. */
export class CalloutLayoutController implements ReactiveController {
  readonly #host: CalloutHost;
  #resize?: ResizeObserver;
  #imageChanges?: MutationObserver;
  #imageRoot: ShadowRoot | undefined;
  #targets = new Set<HTMLElement>();
  #overlay: HTMLElement | undefined;
  #queued = false;

  constructor(host: CalloutHost) {
    this.#host = host;
  }

  hostConnected(): void {
    if (typeof ResizeObserver !== "undefined") {
      this.#resize = new ResizeObserver(this.#schedule);
    }
    this.#imageChanges = new MutationObserver(this.#schedule);
    this.hostUpdated();
  }

  hostDisconnected(): void {
    this.#resize?.disconnect();
    this.#imageChanges?.disconnect();
    this.#targets.clear();
    this.#imageRoot = undefined;
    this.#overlay = undefined;
  }

  hostUpdated(): void {
    const root = this.#host.renderRoot;
    this.#overlay = root.querySelector<HTMLElement>(".callouts") ?? undefined;
    const imageRoot = this.#overlay?.closest("sv-image")?.shadowRoot ?? undefined;
    if (imageRoot !== this.#imageRoot) {
      this.#imageChanges?.disconnect();
      // A new crop can move the image coordinates without changing the overlay's size.
      if (imageRoot !== undefined) {
        this.#imageChanges?.observe(imageRoot, {
          subtree: true,
          childList: true,
          attributeFilter: ["style"],
        });
      }
      this.#imageRoot = imageRoot;
    }
    const targets = new Set(
      this.#overlay === undefined
        ? []
        : [this.#overlay, ...this.#overlay.querySelectorAll<HTMLElement>(".callout")],
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
    this.#schedule();
  }

  readonly #schedule = (): void => {
    if (!this.#queued) {
      this.#queued = true;
      queueMicrotask(() => {
        this.#queued = false;
        this.#measure();
      });
    }
  };

  #measure(): void {
    const overlay = this.#overlay;
    if (overlay === undefined || !overlay.isConnected || overlay.clientWidth === 0) {
      return;
    }
    const style = getComputedStyle(overlay);
    if (style.display === "grid") {
      return; // Compact layouts let CSS arrange the legend.
    }
    const width = overlay.clientWidth;
    const height = overlay.clientHeight;
    const imageLeft = (number(style.getPropertyValue("--sv-image-content-left")) / 100) * width;
    const imageTop = (number(style.getPropertyValue("--sv-image-content-top")) / 100) * height;
    const imageWidth =
      (number(style.getPropertyValue("--sv-image-content-width"), 100) / 100) * width;
    const imageHeight =
      (number(style.getPropertyValue("--sv-image-content-height"), 100) / 100) * height;
    const annotations = [...overlay.querySelectorAll<HTMLElement>(".annotation")];
    const positions = placeFitCallouts(
      annotations.map((annotation) => {
        const card = annotation.querySelector<HTMLElement>(".callout");
        return {
          point: {
            x: imageLeft + number(annotation.dataset["x"] ?? "") * imageWidth,
            y: imageTop + number(annotation.dataset["y"] ?? "") * imageHeight,
          },
          width: card?.offsetWidth ?? 0,
          height: card?.offsetHeight ?? 0,
        };
      }),
      {
        left: number(style.paddingLeft),
        right: width - number(style.paddingRight),
        top: number(style.paddingTop),
        bottom: height - number(style.paddingBottom),
        gap: number(style.rowGap),
      },
    );
    for (const [index, position] of positions.entries()) {
      const annotation = annotations[index];
      if (annotation === undefined) {
        continue;
      }
      annotation.style.setProperty("--_sv-card-x", `${String(position.x)}px`);
      annotation.style.setProperty("--_sv-card-y", `${String(position.y)}px`);
      for (const line of annotation.querySelectorAll("line")) {
        line.setAttribute("x1", String(position.lineStart.x));
        line.setAttribute("y1", String(position.lineStart.y));
        line.setAttribute("x2", String(position.lineEnd.x));
        line.setAttribute("y2", String(position.lineEnd.y));
      }
    }
  }
}
