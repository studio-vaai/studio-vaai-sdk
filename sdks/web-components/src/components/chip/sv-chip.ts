import { css, html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { OptionMark } from "../../internal/option-group/option-mark.js";

import { optionMarkStyles, renderOptionMark } from "../../internal/option-group/option-mark.js";
import { contrast, isHex, readableOn } from "../../internal/theme/color.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_CHIP_STATUSES = ["recommended", "refused", "sold-out", "unavailable"] as const;
export type SvChipStatus = (typeof SV_CHIP_STATUSES)[number];

export interface SvChipProps {
  /** Shown as chosen. Wins over `status` in how it looks. */
  selected?: boolean | undefined;
  /** Optional check for a tried-on option or the current size. */
  mark?: OptionMark | undefined;
  /**
   * How the value stands for this shopper. Unset is a plain, available value. Every status
   * stays pressable.
   *
   * - `recommended`: the recommended size; ringed in green.
   * - `refused`: ruled out by the fit check; muted and struck through.
   * - `sold-out`: out of stock; muted, and marked for screen readers as not available.
   * - `unavailable`: not offered with the other rows' choice; a dashed outline.
   */
  status?: SvChipStatus | undefined;
  /** A color swatch instead of a text chip: the color as `#rrggbb`. */
  color?: string | undefined;
  /**
   * A fabric photo for the swatch, over `color`, which shows while it loads and if it fails.
   * Selected, an image swatch shows only the ring, no check.
   */
  image?: string | undefined;
  /** The accessible name. A swatch needs it (it shows no text); a text chip defaults to its text. */
  label?: string | undefined;
  /** Additional explanation announced after the accessible name. */
  description?: string | undefined;
  /** Not pressable, and dimmed. */
  disabled?: boolean | undefined;
}

/** Below this contrast with white, a swatch gets a hairline so it doesn't vanish on paper. */
const LIGHT_SWATCH_CONTRAST = 1.3;

/**
 * `<sv-chip>` — one value to choose: a size chip with its slotted text, or with `color` (and
 * optionally `image`) a color swatch.
 *
 * Shows whether it's `selected` and its `status` (recommended, refused, sold out or
 * unavailable). A press fires the native `click`, also for refused, sold-out and unavailable
 * values, so the owner can explain them; only `disabled` stops it.
 *
 * @slot - The size label, e.g. "M" or "28/32". Ignored for a swatch.
 * @csspart chip - The native `<button>`.
 */
export class SvChip extends SvElement implements SvChipProps {
  protected override readonly usesMessages = true;
  static override shadowRootOptions: ShadowRootInit = {
    ...SvElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    svTokens,
    svBase,
    optionMarkStyles,
    css`
      :host {
        display: inline-flex;
        flex: none;
        vertical-align: middle;
      }

      .chip {
        appearance: none;
        margin: 0;
        padding: 0;
        border: 0;
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        block-size: calc(var(--_sv-spacing) * 11);
        min-inline-size: calc(var(--_sv-spacing) * 11);
        /* Just enough for XXL in the default font to stay a circle (with the 1px dashed border
           of an unavailable chip); a longer label ("28/32") widens the chip into a pill. */
        padding-inline: calc(var(--_sv-spacing) * 1.5);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-control);
        color: var(--_sv-foreground);
        font-family: inherit;
        font-size: var(--_sv-text-sm);
        line-height: 1;
        font-weight: var(--_sv-font-weight-normal);
        white-space: nowrap;
        cursor: pointer;
        outline: none;
        transition:
          background-color var(--_sv-duration-fast) var(--_sv-ease),
          color var(--_sv-duration-fast) var(--_sv-ease);
      }
      .chip:focus-visible {
        box-shadow:
          0 0 0 2px var(--_sv-background),
          0 0 0 4px var(--_sv-ring);
      }
      .chip:disabled {
        cursor: default;
        opacity: 0.4;
      }

      :host([status="recommended"]) .chip {
        font-weight: var(--_sv-font-weight-semibold);
        box-shadow: inset 0 0 0 2px
          color-mix(in oklab, var(--_sv-positive) 50%, var(--_sv-background));
      }
      :host([status="refused"]) .chip,
      :host([status="sold-out"]) .chip {
        background: var(--_sv-muted);
        color: var(--_sv-muted-foreground);
      }
      /* Struck through only for the fit gate: a verdict about the body, not about stock. */
      :host([status="refused"]) .chip {
        text-decoration: line-through;
      }
      :host([status="unavailable"]) .chip {
        background: transparent;
        color: var(--_sv-muted-foreground);
        border: 1px dashed color-mix(in srgb, var(--_sv-foreground) 16%, var(--_sv-background));
      }
      :host([selected]) .chip {
        background: var(--_sv-control-selected);
        color: var(--_sv-control-selected-foreground);
        font-weight: var(--_sv-font-weight-semibold);
        text-decoration: none;
        border: 0;
        box-shadow: none;
      }

      /* ---------- Swatch ---------- */
      .chip.swatch {
        inline-size: calc(var(--_sv-spacing) * 11);
        overflow: hidden;
      }
      .chip.swatch.light {
        box-shadow: inset 0 0 0 1px
          color-mix(in srgb, var(--_sv-foreground) 16%, var(--_sv-background));
      }
      .disc {
        position: absolute;
        inset: 0;
        overflow: hidden;
        border-radius: inherit;
        background: var(--_sv-muted);
      }
      .disc img {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
        user-select: none;
      }
      :host([status="sold-out"]:not([selected])) .disc {
        opacity: 0.4;
      }
      /* Selected: a 2px primary ring at the edge, a 2px gap of paper, then the color, so the
         swatch never grows past its box. */
      :host([selected]) .chip.swatch {
        background: var(--_sv-control);
        box-shadow: inset 0 0 0 2px var(--_sv-primary);
      }
      :host([selected]) .disc {
        inset: calc(var(--_sv-spacing) * 1);
      }
      .check {
        position: relative;
        --_sv-icon-size: calc(var(--_sv-spacing) * 3.5);
        --_sv-icon-stroke: 2.5;
      }
    `,
  ];

  static override properties = {
    selected: { type: Boolean, reflect: true },
    mark: { attribute: false },
    status: { reflect: true },
    color: {},
    image: {},
    label: {},
    description: {},
    disabled: { type: Boolean, reflect: true },
  };

  declare selected: boolean;
  declare mark: OptionMark | undefined;
  declare status: SvChipStatus | undefined;
  declare color: string | undefined;
  declare image: string | undefined;
  declare label: string | undefined;
  declare description: string | undefined;
  declare disabled: boolean;

  constructor() {
    super();
    this.selected = false;
    this.status = undefined;
    this.color = undefined;
    this.image = undefined;
    this.label = undefined;
    this.description = undefined;
    this.disabled = false;
  }

  /** A photo that fails to load leaves the color behind it. */
  readonly #onImageError = (event: Event): void => {
    if (event.target instanceof HTMLImageElement) {
      event.target.hidden = true;
    }
  };

  get #statusDescription(): string | undefined {
    return (
      this.description ??
      (this.status === undefined ? undefined : this.ui.text(`chip.status.${this.status}`))
    );
  }

  #renderSwatch(color: string | undefined, image: string | undefined) {
    const description = this.#statusDescription ?? "";
    const light =
      image === undefined &&
      color !== undefined &&
      contrast(color, "#ffffff") < LIGHT_SWATCH_CONTRAST;
    const check =
      this.mark === undefined && this.selected && image === undefined && color !== undefined;
    return html`<button
        part="chip"
        class="chip swatch ${light ? "light" : ""}"
        type="button"
        aria-pressed=${this.selected ? "true" : "false"}
        aria-disabled=${this.status === "sold-out" ? "true" : nothing}
        aria-describedby=${description.length > 0 ? "description" : nothing}
        aria-label=${this.label ?? color ?? nothing}
        ?disabled=${this.disabled}
      >
        <span class="disc" style=${styleMap({ background: color })}>
          ${
            image === undefined
              ? nothing
              : html`<img
                  src=${image}
                  alt=""
                  loading="lazy"
                  draggable="false"
                  @error=${this.#onImageError}
                />`
          }
        </span>
        ${renderOptionMark(this.mark)}
        ${
          check
            ? html`<sv-icon
                class="check"
                name="check"
                style=${styleMap({ color: readableOn(color ?? "#000000") })}
              ></sv-icon>`
            : nothing
        }
      </button>
      ${description.length > 0 ? html`<span id="description" hidden>${description}</span>` : nothing}`;
  }

  protected override render() {
    const color = this.color !== undefined && isHex(this.color) ? this.color : undefined;
    const image = this.image !== undefined && this.image !== "" ? this.image : undefined;
    if (color !== undefined || image !== undefined) {
      return this.#renderSwatch(color, image);
    }
    const description = this.#statusDescription ?? "";
    return html`<button
        part="chip"
        class="chip"
        type="button"
        aria-pressed=${this.selected ? "true" : "false"}
        aria-describedby=${description.length > 0 ? "description" : nothing}
        aria-disabled=${this.status === "sold-out" ? "true" : nothing}
        aria-label=${this.label ?? nothing}
        ?disabled=${this.disabled}
      >
        <slot></slot>
        ${renderOptionMark(this.mark)}
      </button>
      ${description.length > 0 ? html`<span id="description" hidden>${description}</span>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-chip": SvChip;
  }
}
