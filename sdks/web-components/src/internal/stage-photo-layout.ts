import type { ReactiveController } from "lit";

import type { SvScreen } from "../components/screen/sv-screen.js";

/** Aligns the split layout to the fitted photo and the secondary action's text baseline. */
export class StagePhotoLayoutController implements ReactiveController {
  readonly #host: SvScreen;
  #stage: HTMLElement | undefined;
  #secondary: HTMLElementTagNameMap["sv-button"] | undefined;
  #frame: HTMLElement | undefined;
  #resize: ResizeObserver | undefined;
  #position?: MutationObserver;
  #scheduled: number | undefined;

  constructor(host: SvScreen) {
    this.#host = host;
  }

  hostConnected(): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this.#host.renderRoot.addEventListener("slotchange", this.#sync);
    this.#host.ownerDocument.fonts?.addEventListener("loadingdone", this.#schedule);
  }

  hostDisconnected(): void {
    this.#host.renderRoot.removeEventListener("slotchange", this.#sync);
    this.#host.ownerDocument.fonts?.removeEventListener("loadingdone", this.#schedule);
    this.#resize?.disconnect();
    this.#position?.disconnect();
    this.#resize = undefined;
    this.#stage = undefined;
    this.#secondary = undefined;
    this.#frame = undefined;
    if (this.#scheduled !== undefined) {
      cancelAnimationFrame(this.#scheduled);
      this.#scheduled = undefined;
    }
  }

  hostUpdated(): void {
    this.#sync();
  }

  readonly #sync = (): void => {
    if (!this.#host.isConnected || typeof ResizeObserver === "undefined") {
      return;
    }
    const root = this.#host.renderRoot;
    const assigned = (name: string) =>
      root.querySelector<HTMLSlotElement>(`slot[name="${name}"]`)?.assignedElements() ?? [];
    const stage =
      this.#host.alignPhoto === undefined || this.#host.stageLayout === "centered"
        ? undefined
        : assigned("stage").find(
            (element): element is HTMLElement =>
              element instanceof HTMLElement && element.getAttribute("aria-hidden") !== "true",
          );
    const secondary = assigned("secondary").find(
      (element): element is HTMLElementTagNameMap["sv-button"] => element.localName === "sv-button",
    );
    if (stage === this.#stage && secondary === this.#secondary) {
      this.#schedule();
      return;
    }
    this.#stage = stage;
    this.#secondary = secondary;
    this.#frame = undefined;
    this.#resize?.disconnect();
    this.#position?.disconnect();
    if (!stage) {
      this.#host.style.removeProperty("--_sv-stage-unused-width");
      this.#host.style.removeProperty("--_sv-stage-actions-offset");
      return;
    }
    this.#resize ??= new ResizeObserver(this.#schedule);
    this.#position ??= new MutationObserver(this.#schedule);
    void this.#observe(this.#resize, stage, secondary);
  };

  async #observe(
    resize: ResizeObserver,
    stage: HTMLElement,
    secondary: HTMLElementTagNameMap["sv-button"] | undefined,
  ): Promise<void> {
    const image = isImage(stage) ? stage : undefined;
    await Promise.all([image?.updateComplete, secondary?.updateComplete]);
    const frame =
      image?.shadowRoot?.querySelector<HTMLElement>('[part="frame"]') ??
      stage.querySelector<HTMLElement>("[data-sv-stage-frame]");
    if (
      resize !== this.#resize ||
      stage !== this.#stage ||
      secondary !== this.#secondary ||
      !frame
    ) {
      return;
    }
    this.#frame = frame;
    resize.observe(stage);
    resize.observe(frame);
    const label = secondary?.shadowRoot?.querySelector('[part="label"]');
    if (label) {
      resize.observe(label);
    }
    this.#position?.observe(frame, { attributeFilter: ["style", "class"] });
    this.#schedule();
  }

  readonly #schedule = (): void => {
    if (this.#frame && this.#scheduled === undefined) {
      this.#scheduled = requestAnimationFrame(() => {
        this.#scheduled = undefined;
        this.#measure();
      });
    }
  };

  #measure(): void {
    const host = this.#host;
    const stage = this.#stage;
    const frame = this.#frame;
    if (!stage || !frame) {
      return;
    }
    const stageStyle = getComputedStyle(stage);
    const unused =
      Number.parseFloat(stageStyle.width) - Number.parseFloat(getComputedStyle(frame).width);
    if (Number.isFinite(unused)) {
      host.style.setProperty("--_sv-stage-unused-width", `${Math.max(0, unused)}px`);
    }
    const stageBounds = stage.getBoundingClientRect();
    const actions = host.renderRoot.querySelector('[part="actions"]');
    const baseline =
      host.alignPhoto === "baseline"
        ? this.#secondary?.shadowRoot?.querySelector(".baseline")
        : null;
    const inset =
      actions && baseline
        ? actions.getBoundingClientRect().bottom - baseline.getBoundingClientRect().top
        : 0;
    // The actions sit at the same height on every step, whatever the photo's proportions: at
    // the bottom of the column, the secondary action's text on the stage's bottom edge, where a
    // full-height photo ends. Convert back to CSS pixels while the dialog is scaling.
    const offset = (-inset * Number.parseFloat(stageStyle.height)) / stageBounds.height;
    if (Number.isFinite(offset)) {
      host.style.setProperty("--_sv-stage-actions-offset", `${offset}px`);
    }
  }
}

function isImage(element: HTMLElement): element is HTMLElementTagNameMap["sv-image"] {
  return element.localName === "sv-image";
}
