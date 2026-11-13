import type { PropertyValues } from "lit";

import { css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { styleMap } from "lit/directives/style-map.js";

import type { SvImageCrop } from "../../media/image-crop.js";
import type { SvImageFraming } from "../../media/image-framing.js";

import { SvElement } from "../../internal/ui-element.js";
import { imageCrop } from "../../media/image-crop.js";
import { resolveImageFraming, validImageAspect } from "../../media/image-framing.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvImageProps {
  /** The image's URL. Unset or empty shows the empty placeholder. */
  src?: string | undefined;
  /** The image's description for screen readers. Unset treats it as decorative. */
  alt?: string | undefined;
  /** The visible rectangle in the source image. Use the crop returned by `sv-camera.capture()`. Property only. */
  crop?: SvImageCrop | undefined;
  /** Shared protected composition. Omit for natural-aspect display; {} keeps result framing stable. */
  framing?: SvImageFraming | undefined;
  /** The image is being made: a translucent shimmer leaves an existing image visible. */
  busy?: boolean | undefined;
  /** Enables temporary two-finger zoom. */
  zoomable?: boolean | undefined;
}

/** Before the image loads: a portrait photo's proportions. */
const DEFAULT_RATIO = 3 / 4;
const MAX_SCALE = 4;
/** A pinch starts once the fingers spread 5% or move 12px, so two-finger drags work too. */
const START_SCALE = 1.05;
const START_MOVE_PX = 12;

interface Pinch {
  /** The image's box when the fingers came down. */
  rect: DOMRect;
  distance: number;
  x: number;
  y: number;
  zooming: boolean;
}

function spread(touches: TouchList): { distance: number; x: number; y: number } | undefined {
  const [a, b] = [touches[0], touches[1]];
  if (!a || !b) {
    return undefined;
  }
  return {
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

/**
 * `<sv-image>` — a picture, such as the shopper's photo or a try-on, in a rounded box that takes
 * the image's proportions.
 *
 * Shows `src` scaled to fit the space it gets, with a gray placeholder while it loads or when
 * there is none, and a shimmer over it while `busy`. With `zoomable`, two fingers lift the
 * image above everything on the page, the page dimming behind it, and scale and move it with
 * the fingers up to four times; when they let go it springs back into place. Pinching it never
 * zooms the page.
 *
 * @csspart frame - The rounded box.
 * @fires sv-image-state - The current image loaded or failed.
 * @csspart image - The `<img>`.
 * @slot overlay - Content over the visible image frame, e.g. fit callouts or image actions.
 * @csspart overlay - The overlay area, sized to the visible image rather than its letterboxing.
 */
export class SvImage extends SvElement implements SvImageProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      /*
       * Two layouts from CSS alone. Given a height (a screen's stage), the image fits inside
       * that box, centered. Without one, it is as wide as its container and as tall as its
       * proportions say. The space takes the image's ratio, which only counts when nothing
       * sets its height; inside it, the frame fits that ratio into the space.
       */
      :host {
        display: grid;
        grid-template: minmax(0, 1fr) / minmax(0, 1fr);
        min-inline-size: 0;
        min-block-size: 0;
      }
      .space {
        position: relative;
        align-self: stretch;
        justify-self: stretch;
        display: grid;
        place-items: center;
        aspect-ratio: var(--_sv-image-ratio);
        container-type: size;
      }
      .frame {
        position: relative;
        inline-size: min(100cqi, 100cqb * var(--_sv-image-ratio));
        aspect-ratio: var(--_sv-image-ratio);
        overflow: hidden;
        border-radius: var(--_sv-radius);
        background: var(--_sv-muted);
      }
      .space.framed .frame {
        position: absolute;
        aspect-ratio: auto;
      }
      .composition {
        position: absolute;
        inset: 0;
      }
      .frame:not(.framed) .composition {
        position: relative;
        inline-size: 100%;
        block-size: 100%;
      }
      /* Lets the page scroll, but never zoom, through the image. */
      :host([zoomable]) .frame {
        touch-action: pan-x pan-y;
      }
      img {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
        dynamic-range-limit: constrained;
      }
      .picture {
        position: relative;
        inline-size: 100%;
        block-size: 100%;
        overflow: hidden;
      }
      .picture img {
        position: absolute;
        inline-size: var(--_sv-image-width);
        block-size: var(--_sv-image-height);
        left: var(--_sv-image-left);
        top: var(--_sv-image-top);
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        pointer-events: none;
      }
      ::slotted([slot="overlay"]) {
        min-inline-size: 0;
        min-block-size: 0;
        pointer-events: auto;
      }
      .frame.zooming img {
        opacity: 0;
      }

      .shine {
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
        background: color-mix(in srgb, var(--_sv-muted) 92%, var(--_sv-background));
      }
      .shine::after {
        content: "";
        position: absolute;
        inset: 0;
        background-image: linear-gradient(
          90deg,
          transparent,
          rgb(192 132 252 / 0.35),
          rgb(96 165 250 / 0.35),
          transparent
        );
        animation: sv-image-shine 1.5s linear 0.5s infinite both;
      }
      .shine.over-image {
        background: color-mix(in srgb, var(--_sv-background) 60%, transparent);
        animation: sv-image-wash-in 600ms ease both;
      }
      .shine.over-image::after {
        background-image: linear-gradient(
          90deg,
          transparent,
          rgb(192 132 252 / 0.6),
          rgb(96 165 250 / 0.6),
          transparent
        );
        animation-delay: 0s;
      }
      @keyframes sv-image-wash-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes sv-image-shine {
        0% {
          transform: translateX(-150%) skewX(-45deg);
        }
        100% {
          transform: translateX(150%) skewX(-45deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .shine.over-image,
        .shine::after {
          animation: none;
        }
      }

      /* ---------- Zoom: a popover, so it sits above dialogs too ---------- */
      .zoom {
        position: fixed;
        inset: 0;
        inline-size: auto;
        block-size: auto;
        margin: 0;
        padding: 0;
        border: 0;
        overflow: visible;
        background: transparent;
        pointer-events: none;
      }
      .zoom:not(:popover-open) {
        display: none;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: var(--_sv-scrim);
        opacity: 0;
      }
      .lifted {
        position: absolute;
        overflow: hidden;
        border-radius: var(--_sv-radius);
        transform-origin: center;
        will-change: transform;
      }
      .lifted img {
        object-fit: contain;
      }
      /* Release: a calm ease-out without overshoot. */
      .zoom.release .backdrop {
        transition: opacity 420ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .zoom.release .lifted {
        transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
      }
    `,
  ];

  static override properties = {
    src: {},
    sourceKey: { attribute: false },
    loadKey: { attribute: false },
    alt: {},
    crop: { attribute: false },
    framing: { attribute: false },
    busy: { type: Boolean, reflect: true },
    zoomable: { type: Boolean, reflect: true },
    _ratio: { state: true },
    _referenceRatio: { state: true },
    _viewport: { state: true },
  };

  declare src: string | undefined;
  /** Internal identity of the current source when distinct images share a URL. */
  declare sourceKey: string | undefined;
  /** Identifies a load requested by the experience. */
  declare loadKey: string | undefined;
  declare alt: string | undefined;
  declare crop: SvImageCrop | undefined;
  declare framing: SvImageFraming | undefined;
  declare busy: boolean;
  declare zoomable: boolean;
  /** Internal: the loaded image's `width / height`. */
  declare _ratio: number | undefined;
  declare _referenceRatio: number | undefined;
  declare _viewport: { width: number; height: number } | undefined;

  #resize: ResizeObserver | undefined;
  #loadAttempt = 0;

  #pinch: Pinch | undefined;
  /** Only a gesture that lifts the image can supersede a pending release. */
  #releases = 0;

  constructor() {
    super();
    this.src = undefined;
    this.alt = undefined;
    this.crop = undefined;
    this.framing = undefined;
    this.busy = false;
    this.zoomable = false;
    this._ratio = undefined;
    this._referenceRatio = undefined;
    this._viewport = undefined;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (
      changed.has("src") ||
      changed.has("sourceKey") ||
      (changed.has("zoomable") && !this.zoomable) ||
      (changed.has("busy") && this.busy)
    ) {
      this.#cancelZoom();
    }
    if (changed.has("src") && this.framing === undefined) {
      this._ratio = undefined;
    }
    if (changed.has("framing") && this.framing === undefined) {
      this._referenceRatio = undefined;
    }
    if (
      changed.has("framing") &&
      !changed.has("src") &&
      this.framing !== undefined &&
      this._referenceRatio === undefined &&
      this._ratio !== undefined
    ) {
      const crop = imageCrop(this.crop);
      this._referenceRatio = (this._ratio * crop.width) / crop.height;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.loadKey !== undefined || !changed.has("sourceKey") || changed.has("src")) {
      return;
    }
    const img = this.renderRoot.querySelector<HTMLImageElement>('img[part="image"]');
    if (img?.complete === true && img.naturalWidth === 0) {
      // A new result may refer to the URL of a failed image. Give it a fresh attempt.
      this.reload();
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#observeSize();
  }

  async #observeSize(): Promise<void> {
    await this.updateComplete;
    if (!this.isConnected || this.#resize || typeof ResizeObserver === "undefined") {
      return;
    }
    this.#resize = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (
        rect &&
        (rect.width !== this._viewport?.width || rect.height !== this._viewport?.height)
      ) {
        this._viewport = { width: rect.width, height: rect.height };
      }
    });
    const space = this.renderRoot.querySelector(".space");
    if (space) {
      this.#resize.observe(space);
    }
  }

  override disconnectedCallback(): void {
    this.#cancelZoom();
    this.#resize?.disconnect();
    this.#resize = undefined;
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    // Non-passive, so a pinch can keep the page from zooming (iOS starts its own otherwise).
    const frame = this.renderRoot.querySelector<HTMLElement>(".frame");
    frame?.addEventListener("touchmove", this.#onTouchMove, { passive: false });
  }

  /** Request the current source again after an image failure. */
  reload(): void {
    this.#loadAttempt += 1;
    this.requestUpdate();
  }

  #reportImage(target: EventTarget | null, state: "ready" | "error"): void {
    if (!(target instanceof HTMLImageElement) || !this.renderRoot.contains(target)) {
      return;
    }
    const src = target.getAttribute("src");
    const { loadKey } = target.dataset;
    if (src !== null && src === this.src) {
      this.dispatchEvent(
        new CustomEvent("sv-image-state", {
          detail: { src, state, ...(loadKey === undefined ? {} : { loadKey }) },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  readonly #onError = (event: Event): void => {
    this.#reportImage(event.target, "error");
  };

  readonly #onLoad = async (event: Event): Promise<void> => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
      this._ratio = img.naturalWidth / img.naturalHeight;
      if (this.framing !== undefined && this._referenceRatio === undefined) {
        const crop = imageCrop(this.crop);
        this._referenceRatio = (this._ratio * crop.width) / crop.height;
      }
    }
    if (img instanceof HTMLImageElement && typeof img.decode === "function") {
      try {
        await img.decode();
      } catch {
        this.#reportImage(img, "error");
        return;
      }
    }
    this.#reportImage(img, "ready");
  };

  // ---------- Pinch ----------

  #part(selector: string): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(selector);
  }

  readonly #onTouchStart = (event: TouchEvent): void => {
    if (!this.zoomable || this.busy || this.#pinch || event.touches.length !== 2) {
      return;
    }
    const start = spread(event.touches);
    const img = this.#part(".frame");
    if (
      !start ||
      start.distance === 0 ||
      !img ||
      typeof this.#part(".zoom")?.showPopover !== "function"
    ) {
      return;
    }
    this.#pinch = { rect: img.getBoundingClientRect(), ...start, zooming: false };
  };

  readonly #onTouchMove = (event: TouchEvent): void => {
    const pinch = this.#pinch;
    const now = event.touches.length >= 2 ? spread(event.touches) : undefined;
    if (!pinch || !now) {
      return;
    }
    event.preventDefault();
    const scale = Math.min(MAX_SCALE, Math.max(1, now.distance / pinch.distance));
    const moved = Math.hypot(now.x - pinch.x, now.y - pinch.y);
    if (!pinch.zooming) {
      if (scale < START_SCALE && moved < START_MOVE_PX) {
        return;
      }
      pinch.zooming = true;
      this.#releases += 1;
      this.#lift(pinch.rect);
    }
    // Scale around the image's center, keeping the point between the fingers under them.
    const { rect } = pinch;
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const x = (pinch.x - originX) * (1 - scale) + (now.x - pinch.x);
    const y = (pinch.y - originY) * (1 - scale) + (now.y - pinch.y);
    this.#show(`translate3d(${String(x)}px, ${String(y)}px, 0) scale(${String(scale)})`, scale);
  };

  readonly #onTouchEnd = (event: TouchEvent): void => {
    if (!this.#pinch || (event.type !== "touchcancel" && event.touches.length >= 2)) {
      return;
    }
    const { zooming } = this.#pinch;
    this.#pinch = undefined;
    if (zooming) {
      void this.#release();
    }
  };

  #show(transform: string, scale: number): void {
    const lifted = this.#part(".lifted");
    const backdrop = this.#part(".backdrop");
    if (lifted && backdrop) {
      lifted.style.transform = transform;
      backdrop.style.opacity = String((scale - 1) / (MAX_SCALE - 1));
    }
  }

  /** Puts a copy of the image over everything, exactly where the image is. */
  #lift(rect: DOMRect): void {
    const zoom = this.#part(".zoom");
    const lifted = this.#part(".lifted");
    if (!zoom || !lifted) {
      return;
    }
    zoom.classList.remove("release");
    Object.assign(lifted.style, {
      top: `${String(rect.top)}px`,
      left: `${String(rect.left)}px`,
      width: `${String(rect.width)}px`,
      height: `${String(rect.height)}px`,
    });
    if (typeof zoom.showPopover === "function" && !zoom.matches(":popover-open")) {
      zoom.showPopover();
    }
    this.#part(".frame")?.classList.add("zooming");
  }

  /** Springs the copy back into place, then puts the image back. */
  async #release(): Promise<void> {
    const zoom = this.#part(".zoom");
    if (!zoom) {
      return;
    }
    const release = this.#releases;
    zoom.classList.add("release");
    this.#show("none", 1);
    const running = zoom
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.allSettled(
      running.map(async (animation) => {
        await animation.finished;
      }),
    );
    if (release === this.#releases) {
      this.#clearLift();
    }
  }

  #cancelZoom(): void {
    this.#releases += 1;
    this.#pinch = undefined;
    this.#clearLift();
  }

  #clearLift(): void {
    const zoom = this.#part(".zoom");
    if (zoom?.matches(":popover-open") === true) {
      zoom.hidePopover();
    }
    zoom?.classList.remove("release");
    this.#part(".frame")?.classList.remove("zooming");
  }

  protected override render() {
    const src = this.src !== undefined && this.src !== "" ? this.src : undefined;
    const crop = imageCrop(this.crop);
    const provisionalRatio = validImageAspect(this.framing?.aspectRatio)
      ? (this.framing.aspectRatio * crop.height) / crop.width
      : DEFAULT_RATIO;
    const sourceRatio = ((this._ratio ?? provisionalRatio) * crop.width) / crop.height;
    let ratio = sourceRatio;
    if (this.framing !== undefined) {
      ratio = validImageAspect(this.framing.aspectRatio)
        ? this.framing.aspectRatio
        : (this._referenceRatio ?? sourceRatio);
    }
    const placement =
      this.framing !== undefined && this._viewport
        ? resolveImageFraming(this._viewport, sourceRatio, ratio, this.framing)
        : undefined;
    const percent = (value: number) => `${String(value * 100)}%`;
    const compositionStyle =
      placement && this._viewport
        ? styleMap({
            inset: "auto",
            left: percent((placement.x - placement.frame.x) / placement.frame.width),
            top: percent((placement.y - placement.frame.y) / placement.frame.height),
            width: percent(placement.width / placement.frame.width),
            height: percent(placement.height / placement.frame.height),
          })
        : nothing;
    const frameStyle =
      placement && this._viewport
        ? styleMap({
            left: percent(placement.frame.x / this._viewport.width),
            top: percent(placement.frame.y / this._viewport.height),
            "inline-size": percent(placement.frame.width / this._viewport.width),
            "block-size": percent(placement.frame.height / this._viewport.height),
          })
        : nothing;
    const overlayStyle =
      placement && this._viewport
        ? styleMap({
            "--sv-image-content-left": percent(
              (placement.x - placement.frame.x + (0.5 - crop.cx / crop.width) * placement.width) /
                placement.frame.width,
            ),
            "--sv-image-content-top": percent(
              (placement.y - placement.frame.y + (0.5 - crop.cy / crop.height) * placement.height) /
                placement.frame.height,
            ),
            "--sv-image-content-width": percent(
              placement.width / crop.width / placement.frame.width,
            ),
            "--sv-image-content-height": percent(
              placement.height / crop.height / placement.frame.height,
            ),
          })
        : styleMap({
            "--sv-image-content-left": percent(0.5 - crop.cx / crop.width),
            "--sv-image-content-top": percent(0.5 - crop.cy / crop.height),
            "--sv-image-content-width": percent(1 / crop.width),
            "--sv-image-content-height": percent(1 / crop.height),
          });
    const pictureStyle = styleMap({
      "--_sv-image-width": `${String(100 / crop.width)}%`,
      "--_sv-image-height": `${String(100 / crop.height)}%`,
      "--_sv-image-left": `${String((0.5 - crop.cx / crop.width) * 100)}%`,
      "--_sv-image-top": `${String((0.5 - crop.cy / crop.height) * 100)}%`,
    });
    return html`<div
        class=${placement ? "space framed" : "space"}
        style="--_sv-image-ratio: ${String(ratio)}"
      >
        <div
          part="frame"
          class=${placement ? "frame framed" : "frame"}
          style=${frameStyle}
          aria-busy=${this.busy ? "true" : nothing}
          @touchstart=${this.#onTouchStart}
          @touchend=${this.#onTouchEnd}
          @touchcancel=${this.#onTouchEnd}
        >
          ${
            src === undefined
              ? nothing
              : html`<div class="composition" style=${compositionStyle}>
                  <div class="picture" style=${pictureStyle}>
                    ${keyed(
                      JSON.stringify([src, this.loadKey, this.#loadAttempt]),
                      html`<img
                        part="image"
                        src=${src}
                        data-load-key=${this.loadKey ?? nothing}
                        alt=${this.alt ?? ""}
                        decoding="async"
                        draggable="false"
                        @load=${this.#onLoad}
                        @error=${this.#onError}
                      />`,
                    )}
                  </div>
                </div>`
          }
          ${this.busy ? html`<div class=${src === undefined ? "shine" : "shine over-image"} aria-hidden="true"></div>` : nothing}
          <div class="overlay" part="overlay" style=${overlayStyle}>
            <slot name="overlay"></slot>
          </div>
        </div>
      </div>
      ${
        this.zoomable && src !== undefined
          ? html`<div class="zoom" popover="manual" aria-hidden="true">
              <div class="backdrop"></div>
              <div class="lifted">
                <div class="composition" style=${compositionStyle}>
                  <div class="picture" style=${pictureStyle}>
                    <img src=${src} alt="" draggable="false" />
                  </div>
                </div>
              </div>
            </div>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-image": SvImage;
  }
  interface HTMLElementEventMap {
    "sv-image-state": CustomEvent<{ src: string; state: "ready" | "error"; loadKey?: string }>;
  }
}
