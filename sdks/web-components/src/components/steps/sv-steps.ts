import { css, html } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvStepsProps {
  /** The steps in order, translated, e.g. "Upload a photo". */
  items?: readonly string[] | undefined;
}

/**
 * `<sv-steps>` — numbered steps, e.g. the intro's "how it works".
 *
 * Shows `items` in order, each beside its number. Screen readers read them as an ordered list.
 *
 * @csspart list - The `<ol>`.
 * @csspart number - Each number.
 */
export class SvSteps extends SvElement implements SvStepsProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
      }
      ol {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: calc(var(--_sv-spacing) * 2.5);
      }
      li {
        display: flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 2.5);
        min-inline-size: 0;
        font-size: var(--_sv-text-sm);
        line-height: 1.375;
        color: var(--_sv-foreground);
      }
      .number {
        flex: none;
        display: grid;
        place-items: center;
        inline-size: calc(var(--_sv-spacing) * 5);
        block-size: calc(var(--_sv-spacing) * 5);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-primary);
        color: var(--_sv-primary-foreground);
        font-size: var(--_sv-text-xs);
        line-height: 1;
        font-weight: var(--_sv-font-weight-medium);
      }
    `,
  ];

  static override properties = {
    items: { attribute: false },
  };

  declare items: readonly string[];

  constructor() {
    super();
    this.items = [];
  }

  protected override render() {
    return html`<ol part="list" role="list">
      ${this.items.map(
        (step, index) =>
          html`<li>
            <span part="number" class="number" aria-hidden="true">${index + 1}</span>
            <span>${step}</span>
          </li>`,
      )}
    </ol>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-steps": SvSteps;
  }
}
