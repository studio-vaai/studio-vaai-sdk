import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { Point, Rect } from "./callout-layout.js";

import { FADE_FRACTION, fadeLeader, placeFitCallouts, placeFitLegend } from "./callout-layout.js";

type CalloutHost = ReactiveControllerHost & { readonly renderRoot: HTMLElement | DocumentFragment };

function number(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function anchorPoints(value: string | undefined): [number, number][] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (point): point is [number, number] =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((value) => Number.isFinite(value)),
        )
      : [];
  } catch {
    return [];
  }
}

function subjectBands(value: string | undefined): [number, number, number, number][] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (band): band is [number, number, number, number] =>
            Array.isArray(band) &&
            band.length === 4 &&
            band.every((value) => Number.isFinite(value)),
        )
      : [];
  } catch {
    return [];
  }
}

/** The steps a leader fades out in. */
const FADE_STEPS = 8;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Draw a leader: its solid part as the halo and stroke polylines, then the fading steps. */
function drawLeader(annotation: HTMLElement, path: readonly Point[]): void {
  const { solid, fade } = fadeLeader(path, FADE_FRACTION, FADE_STEPS);
  const points = solid.map(({ x, y }) => `${String(x)},${String(y)}`).join(" ");
  for (const line of annotation.querySelectorAll(".leader > polyline")) {
    line.setAttribute("points", points);
  }
  const group = annotation.querySelector(".leader-fade");
  if (group === null) {
    return;
  }
  group.replaceChildren(
    ...fade.flatMap(({ from, to, offset, opacity }) =>
      ["leader-halo", "leader-stroke"].map((kind) => {
        const line = document.createElementNS(SVG_NAMESPACE, "line");
        line.setAttribute("class", kind);
        line.setAttribute("x1", String(from.x));
        line.setAttribute("y1", String(from.y));
        line.setAttribute("x2", String(to.x));
        line.setAttribute("y2", String(to.y));
        line.setAttribute("stroke-dashoffset", String(offset));
        line.setAttribute("opacity", String(opacity));
        return line;
      }),
    ),
  );
}

/**
 * Measures the fitted image and the localized cards without adding screen state, then places
 * the cards with `placeFitCallouts`, or, when they do not fit beside the person, lists them as a
 * legend with numbered anchors (`data-layout="legend"`).
 */
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
      delete overlay.dataset["layout"];
      return; // Small frames let CSS arrange the legend.
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
    const subject = subjectBands(overlay.dataset["subject"]).map(
      ([top, bottom, left, right]): Rect => ({
        top: imageTop + top * imageHeight,
        bottom: imageTop + bottom * imageHeight,
        left: imageLeft + left * imageWidth,
        right: imageLeft + right * imageWidth,
      }),
    );
    const bounds = overlay.getBoundingClientRect();
    const keepOut = [...(overlay.parentElement?.querySelectorAll<HTMLElement>(".download") ?? [])]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0)
      .map((rect) => ({
        left: rect.left - bounds.left,
        top: rect.top - bounds.top,
        right: rect.right - bounds.left,
        bottom: rect.bottom - bounds.top,
      }));
    const gap = number(style.rowGap);
    const area = {
      left: number(style.paddingLeft),
      right: width - number(style.paddingRight),
      top: number(style.paddingTop),
      bottom: height - number(style.paddingBottom),
      gap,
      // The styles carry the clearance from the person as the (otherwise unused) column gap.
      clearance: number(style.columnGap, gap),
      keepOut,
    };
    const anchors = [...overlay.querySelectorAll<HTMLElement>(".anchor")];
    const inView = ({ x, y }: { x: number; y: number }) =>
      x >= 0 && x <= width && y >= 0 && y <= height;
    const callouts = annotations.map((annotation) => {
      const card = annotation.querySelector<HTMLElement>(".callout");
      // A crop can hide the anchor: then use the same measurement's other side, if in view.
      const points = [
        [number(annotation.dataset["x"] ?? ""), number(annotation.dataset["y"] ?? "")],
        ...anchorPoints(annotation.dataset["alternates"]),
      ].map(([x = 0, y = 0]) => ({ x: imageLeft + x * imageWidth, y: imageTop + y * imageHeight }));
      return {
        point: points.find((point) => inView(point)) ?? points[0] ?? { x: 0, y: 0 },
        alternates: points.filter((point) => inView(point)).slice(1),
        width: card?.offsetWidth ?? 0,
        height: card?.offsetHeight ?? 0,
      };
    });
    if (callouts.some((callout) => callout.width === 0 || callout.height === 0)) {
      return; // The cards have not rendered yet; their resize schedules the layout.
    }
    // Cards beside the person; a numbered legend when they do not fit there.
    let layout = placeFitCallouts(callouts, area, subject.length > 0 ? subject : undefined);
    if (!layout.clear && callouts.length > 0) {
      layout = placeFitLegend(callouts, area, subject.length > 0 ? subject : undefined);
    }
    overlay.dataset["layout"] = layout.kind;
    for (const [index, placed] of layout.cards.entries()) {
      const annotation = annotations[index];
      if (annotation === undefined || placed === undefined) {
        continue;
      }
      annotation.dataset["side"] = placed.side;
      anchors[index]?.style.setProperty("left", `${String(placed.anchor.x)}px`);
      anchors[index]?.style.setProperty("top", `${String(placed.anchor.y)}px`);
      annotation.style.setProperty("--_sv-card-x", `${String(placed.x)}px`);
      annotation.style.setProperty("--_sv-card-y", `${String(placed.y)}px`);
      drawLeader(annotation, placed.path);
    }
  }
}
