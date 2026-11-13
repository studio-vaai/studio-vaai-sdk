import { css, html, nothing } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_BUTTON_VARIANTS = ["primary", "ghost"] as const;
export type SvButtonVariant = (typeof SV_BUTTON_VARIANTS)[number];

export interface SvButtonProps {
  /**
   * `primary` for the one main action on a screen: a filled block. `ghost` for the other one:
   * plain text without a box, e.g. "Use a different photo".
   */
  variant?: SvButtonVariant | undefined;
  /** The button cannot be pressed. */
  disabled?: boolean | undefined;
  /** Announced as unavailable but still pressable, so the host can explain a missing prerequisite. */
  blocked?: boolean | undefined;
  /**
   * The action is running: shows a spinner, sets `aria-busy` and swallows presses, while the
   * label stays readable.
   */
  busy?: boolean | undefined;
}

/**
 * `<sv-button>` — a button for the flow's actions.
 *
 * A press fires the native `click`. While `disabled` or `busy` it can't be pressed and fires
 * nothing; `busy` also shows a spinner beside the label.
 *
 * @slot - The label.
 * @csspart button - The native `<button>`.
 * @csspart spinner - The spinner shown while `busy`.
 * @csspart label - The label wrapper, for arranging composed labels such as an icon-only action.
 */
export class SvButton extends SvElement implements SvButtonProps {
  static override shadowRootOptions: ShadowRootInit = {
    ...SvElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    svTokens,
    svBase,
    css`
      /* A flex host, so a text button stays vertically centered when a row stretches it to the
         primary's height. */
      :host {
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
      }
      .button {
        appearance: none;
        margin: 0;
        border: 0;
        inline-size: 100%;
        block-size: var(--_sv-button-height);
        padding-inline: calc(var(--_sv-spacing) * 4);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: calc(var(--_sv-spacing) * 2);
        border-radius: var(--_sv-radius);
        font-family: inherit;
        font-size: var(--_sv-action-text-size, var(--_sv-text-base));
        line-height: var(--_sv-text-base--line-height);
        font-weight: var(--_sv-font-weight-medium);
        white-space: nowrap;
        cursor: pointer;
        background: var(--_sv-primary);
        color: var(--_sv-primary-foreground);
        transition:
          background-color var(--_sv-duration-fast) var(--_sv-ease),
          opacity var(--_sv-duration-fast) var(--_sv-ease);
      }
      .button:hover {
        background: var(--_sv-primary-hover);
      }
      .button:focus-visible {
        outline: 2px solid var(--_sv-ring);
        outline-offset: 2px;
      }

      /* Secondary: text only, shorter than the primary, never outlined. */
      :host([variant="ghost"]) .button {
        block-size: calc(var(--_sv-spacing) * 8);
        padding-inline: calc(var(--_sv-spacing) * 2);
        background: transparent;
        color: var(--_sv-foreground);
        font-size: var(--_sv-action-text-size, var(--_sv-text-sm));
        line-height: var(--_sv-text-sm--line-height);
        font-weight: var(--_sv-font-weight-normal);
      }
      :host([variant="ghost"]) .button:hover {
        background: transparent;
        color: var(--_sv-muted-foreground);
      }

      .button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      :host([busy]) .button {
        cursor: progress;
      }
      .label {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];

  static override properties = {
    variant: { reflect: true },
    disabled: { type: Boolean, reflect: true },
    blocked: { type: Boolean },
    busy: { type: Boolean, reflect: true },
  };

  /** Unset renders `primary`. */
  declare variant: SvButtonVariant | undefined;
  declare disabled: boolean;
  declare blocked: boolean;
  declare busy: boolean;

  constructor() {
    super();
    this.variant = undefined;
    this.disabled = false;
    this.blocked = false;
    this.busy = false;
  }

  /** While busy, a press must not reach the host's listeners. */
  readonly #onClick = (event: MouseEvent): void => {
    if (this.busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  protected override render() {
    return html`<button
      part="button"
      class="button"
      type="button"
      ?disabled=${this.disabled}
      aria-disabled=${this.blocked ? "true" : nothing}
      aria-busy=${this.busy ? "true" : nothing}
      @click=${this.#onClick}
    >
      ${this.busy ? html`<sv-spinner part="spinner" size="sm"></sv-spinner>` : nothing}
      <span part="label" class="label"><slot></slot></span>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-button": SvButton;
  }
}
