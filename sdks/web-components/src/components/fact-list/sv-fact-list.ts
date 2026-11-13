import { css, html } from "lit";

import type { SvIconName } from "../icon/sv-icon.js";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvFact {
  /** The icon beside the sentence. It restates the sentence, so it's hidden from screen readers. */
  icon: SvIconName;
  /** The sentence, translated. */
  text: string;
}

export interface SvFactListProps {
  /** The facts in order, each an icon and a sentence. */
  items?: readonly SvFact[] | undefined;
}

/**
 * `<sv-fact-list>` — a list of short facts, each with an icon, e.g. what happens to the
 * shopper's photo.
 *
 * Shows `items` in order. The icons are decorative; screen readers read the sentences as a
 * list.
 *
 * @csspart list - The `<ul>`.
 */
export class SvFactList extends SvElement implements SvFactListProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: calc(var(--_sv-spacing) * 2);
      }
      li {
        display: flex;
        align-items: flex-start;
        gap: calc(var(--_sv-spacing) * 2.5);
        min-inline-size: 0;
        font-size: var(--_sv-text-xs);
        line-height: 1.375;
        color: var(--_sv-muted-foreground);
      }
      sv-icon {
        --_sv-icon-size: calc(var(--_sv-spacing) * 3.5);
        margin-block-start: 1px;
      }
      sv-icon:is([name="eye"], [name="trash"]) {
        --_sv-icon-stroke: 1.5;
      }
    `,
  ];

  static override properties = {
    items: { attribute: false },
  };

  declare items: readonly SvFact[];

  constructor() {
    super();
    this.items = [];
  }

  protected override render() {
    return html`<ul part="list" role="list">
      ${this.items.map(
        (item) =>
          html`<li>
            <sv-icon name=${item.icon}></sv-icon>
            <span>${item.text}</span>
          </li>`,
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-fact-list": SvFactList;
  }
}
