import { css, html, nothing, svg } from "lit";

import type { SvAppearance } from "../../internal/theme/tokens.js";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

type ArtLoader = () => Promise<{ default: string }>;

interface Callout {
  x: number;
  y: number;
  lineLength: number;
}

// Each callout is anchored at the end nearest the people. Its line extends left, then the
// label follows after a shared gap, centered as a block on that same horizontal axis.
const LABEL_GAP = 8;
const LABEL_LINE_HEIGHT = 15;
const CALLOUTS = {
  pose: { x: 152, y: 227.5, lineLength: 24 },
  clothing: { x: 156, y: 450.5, lineLength: 11 },
} satisfies Record<string, Callout>;
// The legacy landscape guide places the label beside the top of the arrow.
const BODY_GUIDE = { x: 459.5, y: 14, length: 562, labelX: 468, labelY: 61, lineHeight: 17 };
// Leave extra space at the right of the legacy frame for the longer live translations.
const GUIDE_WIDTH = 589;

// All labels share each photo. Only the selected appearance is fetched.
const PHOTOS: Record<SvAppearance, ArtLoader> = {
  light: async () => await import("../../assets/guide-people-light.webp?url"),
  dark: async () => await import("../../assets/guide-people-dark.webp?url"),
};

/**
 * `<sv-photo-guide>` — two people photographed head to toe, with pose and clothing labels.
 * One compact SVG; the caller controls its size and position. Labels are live SVG text using
 * the theme's font and foreground; guide lines use `--sv-annotation`.
 * Exposes the photo instructions as its accessible name; the illustration is a single image.
 *
 * @csspart image - The complete `<svg>` illustration.
 * @csspart people - The transparent photograph's `<image>`.
 * @csspart labels - The SVG text group.
 */
export class SvPhotoGuide extends SvElement {
  protected override readonly usesMessages = true;
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
        min-inline-size: 0;
        min-block-size: 0;
      }
      svg[part="image"] {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        pointer-events: none;
        user-select: none;
      }
      .labels {
        fill: var(--_sv-foreground);
        font-family: inherit;
        font-size: 12px;
        font-weight: var(--_sv-font-weight-normal);
      }
      .body-label {
        font-size: 14px;
      }
      .annotations {
        fill: var(--_sv-annotation);
        stroke: var(--_sv-annotation);
      }
    `,
  ];

  static override properties = {
    _src: { state: true },
  };

  declare _src: string | undefined;

  /** A slow photo load must not replace a newer appearance. */
  #loads = 0;
  #appearance: SvAppearance | undefined;

  constructor() {
    super();
    this._src = undefined;
  }

  protected override willUpdate(): void {
    const { appearance } = this.ui.snapshot;
    if (appearance !== this.#appearance) {
      this.#appearance = appearance;
      void this.#load(PHOTOS[appearance]);
    }
  }

  async #load(loader: ArtLoader): Promise<void> {
    this.#loads += 1;
    const load = this.#loads;
    const { default: src } = await loader();
    if (load === this.#loads) {
      this._src = src;
    }
  }

  #renderCallout({ x, y, lineLength }: Callout, lines: readonly string[]) {
    const labelX = -lineLength - LABEL_GAP;
    return svg`<g transform="translate(${x} ${y})">
      <line class="annotations" x1=${-lineLength} x2="0" y1="0" y2="0"></line>
      <text text-anchor="end" dominant-baseline="middle">
        ${lines.map(
          (line, index) => svg`<tspan
          x=${labelX}
          y=${(index - (lines.length - 1) / 2) * LABEL_LINE_HEIGHT}
        >${line}</tspan>`,
        )}
      </text>
    </g>`;
  }

  protected override render() {
    const labels = {
      body: this.ui.text("guideGraphic.fullBody").split("\n"),
      pose: this.ui.text("guideGraphic.naturalPose").split("\n"),
      clothing: this.ui.text("guideGraphic.everydayClothing").split("\n"),
    };
    return html`<svg
      part="image"
      width=${GUIDE_WIDTH}
      height="600"
      viewBox="0 0 ${GUIDE_WIDTH} 600"
      role="img"
      aria-label=${Object.values(labels)
        .map((lines) => lines.join(" "))
        .join(". ")}
      focusable="false"
    >
      <svg x="121" y="0" width="374" height="600" overflow="hidden">
        <image
          part="people"
          href=${this._src ?? nothing}
          x="-36.933"
          y="-10.895"
          width="433.84"
          height="646.782"
          preserveAspectRatio="none"
        ></image>
      </svg>
      <g class="annotations" transform="translate(${BODY_GUIDE.x} ${BODY_GUIDE.y})">
        <line x1="0" x2="0" y1="4.5" y2=${BODY_GUIDE.length - 4.5}></line>
        <path d="M0 0L-2.8875 5H2.8875Z" stroke="none"></path>
        <path
          d="M0 0L-2.8875 -5H2.8875Z"
          transform="translate(0 ${BODY_GUIDE.length})"
          stroke="none"
        ></path>
      </g>
      <g part="labels" class="labels">
        <text class="body-label" y=${BODY_GUIDE.labelY}>
          ${labels.body.map((line, index) => svg`<tspan x=${BODY_GUIDE.labelX} dy=${index === 0 ? 0 : BODY_GUIDE.lineHeight}>${line}</tspan>`)}
        </text>
        ${this.#renderCallout(CALLOUTS.pose, labels.pose)}
        ${this.#renderCallout(CALLOUTS.clothing, labels.clothing)}
      </g>
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-photo-guide": SvPhotoGuide;
  }
}
