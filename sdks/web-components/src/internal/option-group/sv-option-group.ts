import { AxisControl, ItemDisplay, itemDisplayText } from "@studio-vaai/core";
import { css, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { Option } from "./option.js";

import { emitChange } from "../../events.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";
import { itemGlyphIcon } from "../item-display.js";
import { SvElement } from "../ui-element.js";
import { optionMarkStyles } from "./option-mark.js";
import { renderSegments, segmentStyles } from "./segments.js";

/** @internal The picker and result toolbar share rendering, while their owners resolve choices. */
export class SvOptionGroup extends SvElement {
  static override properties = {
    options: { attribute: false },
    label: {},
    control: { attribute: false },
  };

  static override styles = [
    svTokens,
    svBase,
    segmentStyles,
    optionMarkStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
        max-inline-size: 100%;
      }
      .chips {
        display: flex;
        gap: calc(var(--_sv-spacing) * 1.5);
        min-inline-size: 0;
        overflow-x: auto;
        margin-inline: calc(var(--_sv-spacing) * -0.5);
        padding: calc(var(--_sv-spacing) * 0.5);
        scrollbar-width: none;
      }
      .chips.swatches {
        gap: calc(var(--_sv-spacing) * 2.5);
      }
      :host([wrap]) .chips {
        flex-wrap: wrap;
        overflow: visible;
        margin: 0;
        padding: 0;
        gap: calc(var(--_sv-spacing) * 1.5);
      }
      .item-content {
        display: inline-flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 1.5);
      }
      .item-label {
        display: grid;
      }
      .item-label span,
      .item-label::after {
        grid-area: 1 / 1;
      }
      /* Reserve the selected weight without duplicating the chip's slotted text. */
      .item-label::after {
        content: attr(data-label);
        visibility: hidden;
        font-weight: var(--_sv-font-weight-semibold);
        pointer-events: none;
      }
    `,
  ];

  declare options: readonly Option[];
  declare label: string | undefined;
  declare control: AxisControl | undefined;

  constructor() {
    super();
    this.options = [];
    this.label = undefined;
    this.control = undefined;
  }

  readonly #onSelect = (key: string): void => {
    emitChange(this, key);
  };

  #chip(option: Option) {
    const { display } = option;
    const text = itemDisplayText(display);
    return html`<sv-chip
      .selected=${option.selected}
      .mark=${option.mark}
      .status=${option.status}
      .color=${ItemDisplay.Color.instanceOf(display) ? display.inner.hex : undefined}
      .image=${ItemDisplay.Image.instanceOf(display) ? display.inner.url : undefined}
      .label=${text}
      .description=${option.description}
      .disabled=${option.disabled}
      @click=${() => {
        if (!option.disabled) {
          this.#onSelect(option.key);
        }
      }}
      ><span class="item-content">
        ${ItemDisplay.Glyph.instanceOf(display) ? html`<sv-icon name=${itemGlyphIcon[display.inner.glyph]}></sv-icon>` : nothing}
        <span class="item-label" data-label=${text}><span>${text}</span></span>
      </span></sv-chip
    >`;
  }

  protected override render() {
    if (this.control === AxisControl.Segmented) {
      return html`<div part="chips" class="chips">
        ${renderSegments(this.options, this.label, this.#onSelect)}
      </div>`;
    }
    const swatches = this.options.every(
      ({ display }) =>
        ItemDisplay.Color.instanceOf(display) || ItemDisplay.Image.instanceOf(display),
    );
    return html`<div
      part="chips"
      class=${swatches ? "chips swatches" : "chips"}
      role="group"
      aria-label=${this.label ?? nothing}
    >
      ${repeat(
        this.options,
        (option) => option.key,
        (option) => this.#chip(option),
      )}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-option-group": SvOptionGroup;
  }
}
