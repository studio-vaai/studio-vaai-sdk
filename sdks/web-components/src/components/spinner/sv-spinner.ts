import { css, html, nothing } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_SPINNER_SIZES = ["sm", "md"] as const;
export type SvSpinnerSize = (typeof SV_SPINNER_SIZES)[number];

export interface SvSpinnerProps {
  /** `sm` sits inside buttons, `md` everywhere else. */
  size?: SvSpinnerSize | undefined;
  /**
   * Announced to screen readers as a status, e.g. "Uploading photo". Leave it out when the
   * spinner only decorates something that already says it is busy (a `busy` button).
   */
  label?: string | undefined;
}

/**
 * `<sv-spinner>` — a loading indicator, in the current text color.
 *
 * Spins until removed. With a `label`, screen readers announce it as loading; without, it's
 * hidden from them.
 *
 * @csspart spinner - The rotating ring.
 */
export class SvSpinner extends SvElement implements SvSpinnerProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
        --_sv-spinner-size: calc(var(--_sv-spacing) * 5);
      }
      :host([size="sm"]) {
        --_sv-spinner-size: calc(var(--_sv-spacing) * 4);
      }
      .spinner {
        display: block;
        inline-size: var(--_sv-spinner-size);
        block-size: var(--_sv-spinner-size);
        border-radius: var(--_sv-radius-full);
        border: calc(var(--_sv-spacing) * 0.5) solid currentColor;
        border-block-start-color: transparent;
        opacity: 0.8;
        animation: sv-spin 0.8s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        /* A loading indicator still has to move; slower, never frozen. */
        .spinner {
          animation-duration: 1.6s !important;
          animation-iteration-count: infinite !important;
        }
      }
      @keyframes sv-spin {
        to {
          transform: rotate(1turn);
        }
      }
    `,
  ];

  static override properties = {
    size: { reflect: true },
    label: {},
  };

  /** Unset renders `md`. */
  declare size: SvSpinnerSize | undefined;
  declare label: string | undefined;

  constructor() {
    super();
    this.size = undefined;
    this.label = undefined;
  }

  protected override render() {
    const labelled = this.label !== undefined && this.label !== "";
    return html`<span
      part="spinner"
      class="spinner"
      role=${labelled ? "status" : nothing}
      aria-label=${labelled ? this.label : nothing}
      aria-hidden=${labelled ? nothing : "true"}
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-spinner": SvSpinner;
  }
}
