import { css, html, nothing } from "lit";

import type { SvFieldAccessibilityProps } from "../../internal/field-accessibility.js";

import { emitChange } from "../../events.js";
import { fieldDescriptionIds } from "../../internal/field-accessibility.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvCheckboxProps extends SvFieldAccessibilityProps {
  /** Ticked. Only the owner changes it: a press asks with `sv-change`. */
  checked?: boolean | undefined;
  /** Not pressable, e.g. while the photo uploads. */
  disabled?: boolean | undefined;
}

/**
 * `<sv-checkbox>` — a checkbox with its text, e.g. the consent on the intro.
 *
 * A press on the box or the text fires `sv-change` with the state asked for; the box only
 * changes when the owner sets `checked`. A press on a link in the text opens the link and fires
 * nothing. Space and Enter press it from the keyboard.
 *
 * @slot - The text. Links in it work.
 * @fires sv-change - The box or text was pressed; `detail.value` is the `checked` asked for.
 * @csspart box - The box.
 * @csspart text - The text beside it.
 * @csspart validation-error - The field error, also referenced by the checkbox's accessible description.
 */
export class SvCheckbox extends SvElement implements SvCheckboxProps {
  static override shadowRootOptions: ShadowRootInit = {
    ...SvElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        align-items: flex-start;
        gap: calc(var(--_sv-spacing) * 3);
        cursor: pointer;
      }
      :host([disabled]) .row {
        cursor: default;
      }

      .box {
        appearance: none;
        margin: calc(var(--_sv-spacing) * 0.5) 0 0;
        padding: 0;
        flex: none;
        display: grid;
        place-items: center;
        inline-size: calc(var(--_sv-spacing) * 4);
        block-size: calc(var(--_sv-spacing) * 4);
        border: 2px solid var(--_sv-primary);
        border-radius: calc(var(--_sv-radius) * 0.25);
        background: var(--_sv-control);
        color: var(--_sv-control-selected-foreground);
        cursor: inherit;
        outline: none;
      }
      .box:focus-visible {
        box-shadow:
          0 0 0 2px var(--_sv-background),
          0 0 0 4px var(--_sv-ring);
      }
      :host([checked]) .box {
        background: var(--_sv-control-selected);
      }
      .box:disabled {
        opacity: 0.5;
      }
      .check {
        --_sv-icon-stroke: 3.5;
      }

      .text {
        min-inline-size: 0;
        font-size: var(--_sv-text-xs);
        line-height: 1.375;
        color: var(--_sv-muted-foreground);
      }
    `,
  ];

  static override properties = {
    validationError: { attribute: "validation-error" },
    description: {},
    checked: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
  };

  declare checked: boolean;
  declare disabled: boolean;
  declare validationError: string | undefined;
  declare description: string | undefined;

  constructor() {
    super();
    this.checked = false;
    this.disabled = false;
    this.validationError = undefined;
    this.description = undefined;
  }

  /**
   * One handler for the row: the box and the text both toggle, a link in the text doesn't. The
   * box's own Space and Enter arrive here as clicks too.
   */
  readonly #onClick = (event: MouseEvent): void => {
    if (this.disabled) {
      return;
    }
    const fromLink = event
      .composedPath()
      .some((node) => node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement);
    if (fromLink) {
      return;
    }
    emitChange(this, !this.checked);
  };

  protected override render() {
    return html`<div class="row" @click=${this.#onClick}>
        <button
          part="box"
          class="box"
          type="button"
          role="checkbox"
          aria-checked=${this.checked ? "true" : "false"}
          aria-labelledby="text"
          aria-invalid=${typeof this.validationError === "string" && this.validationError !== "" ? "true" : nothing}
          aria-describedby=${fieldDescriptionIds(this.description, this.validationError) ?? nothing}
          ?disabled=${this.disabled}
        >
          ${this.checked ? html`<sv-icon class="check" name="check" size="sm"></sv-icon>` : nothing}
        </button>
        <span part="text" class="text" id="text"><slot></slot></span>
      </div>
      ${typeof this.description === "string" && this.description !== "" ? html`<span id="field-description" class="sv-sr-only">${this.description}</span>` : nothing}
      <span id="field-error" part="validation-error" class="sv-field-error" role="alert"
        >${this.validationError ?? ""}</span
      >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-checkbox": SvCheckbox;
  }
}
