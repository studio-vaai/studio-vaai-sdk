import { css, html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import { contrast, isHex } from "../../internal/theme/color.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvHistoryChipProps {
  /** Outlined as the try-on on screen. */
  selected?: boolean | undefined;
  /** The colorway's dot, `#rrggbb`. */
  color?: string | undefined;
  /** A fabric photo in the dot, over `color`. */
  image?: string | undefined;
  /** The accessible name, e.g. "S, White". Defaults to the visible text. */
  label?: string | undefined;
  /** Prevents requesting another result while the host is busy. */
  disabled?: boolean | undefined;
}

/**
 * `<sv-history-chip>` — one earlier try-on: a dot in its color (or fabric `image`) and its size.
 *
 * Shows whether it's the one on screen with `selected`. A press fires the native `click`.
 *
 * @slot - The size, e.g. "S" or "28/32".
 * @csspart chip - The native `<button>`.
 * @csspart dot - The color dot.
 */
export class SvHistoryChip extends SvElement implements SvHistoryChipProps {
  static override shadowRootOptions: ShadowRootInit = {
    ...SvElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: inline-flex;
        flex: none;
      }
      .chip {
        appearance: none;
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 1.5);
        padding: calc(var(--_sv-spacing) * 1) calc(var(--_sv-spacing) * 3)
          calc(var(--_sv-spacing) * 1) calc(var(--_sv-spacing) * 1);
        border: 1px solid var(--_sv-glass-border);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-glass);
        backdrop-filter: blur(4px);
        color: var(--_sv-foreground);
        font-family: inherit;
        font-size: var(--_sv-text-xs);
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        outline: none;
        transition:
          background-color var(--_sv-duration-fast) var(--_sv-ease),
          border-color var(--_sv-duration-fast) var(--_sv-ease);
      }
      :host([selected]) .chip {
        border-color: var(--_sv-foreground);
        background: var(--_sv-control);
        color: var(--_sv-foreground);
        font-weight: var(--_sv-font-weight-medium);
      }
      .chip:focus-visible {
        box-shadow: 0 0 0 2px var(--_sv-ring);
      }
      .chip:disabled {
        cursor: default;
        opacity: 0.4;
      }
      .chip.without-dot {
        padding-inline: calc(var(--_sv-spacing) * 3);
      }
      .dot {
        position: relative;
        flex: none;
        overflow: hidden;
        inline-size: calc(var(--_sv-spacing) * 5);
        block-size: calc(var(--_sv-spacing) * 5);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-muted);
      }
      .dot.ringed {
        box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.1);
      }
      .dot img {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
      }
    `,
  ];

  static override properties = {
    selected: { type: Boolean, reflect: true },
    color: {},
    image: {},
    label: {},
    disabled: { type: Boolean, reflect: true },
  };

  declare selected: boolean;
  declare color: string | undefined;
  declare image: string | undefined;
  declare label: string | undefined;
  declare disabled: boolean;

  constructor() {
    super();
    this.selected = false;
    this.color = undefined;
    this.image = undefined;
    this.label = undefined;
    this.disabled = false;
  }

  protected override render() {
    const color = this.color !== undefined && isHex(this.color) ? this.color : undefined;
    const image = this.image !== undefined && this.image !== "" ? this.image : undefined;
    // A hairline where the dot would vanish on the pill: light colors and fabric photos.
    const ringed = image !== undefined || (color !== undefined && contrast(color, "#ffffff") < 1.3);
    return html`<button
      part="chip"
      class="chip ${color === undefined && image === undefined ? "without-dot" : ""}"
      type="button"
      ?disabled=${this.disabled}
      aria-pressed=${this.selected ? "true" : "false"}
      aria-label=${this.label ?? nothing}
    >
      ${
        color === undefined && image === undefined
          ? nothing
          : html`<span
              part="dot"
              class="dot ${ringed ? "ringed" : ""}"
              style=${styleMap({ background: color })}
            >
              ${image === undefined ? nothing : html`<img src=${image} alt="" draggable="false" />`}
            </span>`
      }
      <slot></slot>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-history-chip": SvHistoryChip;
  }
}
