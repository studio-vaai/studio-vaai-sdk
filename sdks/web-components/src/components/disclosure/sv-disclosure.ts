import type { PropertyValues } from "lit";

import { css, html } from "lit";

import {
  measuredBlockSize,
  notifyPanelRestingSize,
  panelRestingSize,
} from "../../internal/panel-layout.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvToggleDetail {
  open: boolean;
}

export interface SvDisclosureProps {
  /** The row the shopper presses, e.g. "What happens to my photo?". */
  heading?: string | undefined;
  /** Shows the content. Set it to open or close from outside; a press changes it too. */
  open?: boolean | undefined;
  /** The host owns `open`: presses request `sv-toggle` without changing it. */
  controlled?: boolean | undefined;
}

/**
 * `<sv-disclosure>` — a card with a heading that opens to show more, e.g. "What happens to my
 * photo?".
 *
 * Pressing the heading opens or closes it, animated, and fires `sv-toggle` with the new state;
 * `open` follows. Setting `open` from outside opens or closes it without an event. It works
 * like a native `<details>`: by keyboard, for screen readers, and find-in-page opens it to show
 * a match.
 *
 * @slot - The content shown when open.
 * @slot trailing - Content between the heading and the chevron, e.g. a percentage.
 * @fires sv-toggle - The heading was pressed; `detail.open` is the new state.
 * @csspart card - The card around heading and content.
 * @csspart summary - The pressable heading row.
 * @csspart chevron - The chevron, turned while open.
 * @csspart content - The content area.
 */
export class SvDisclosure extends SvElement implements SvDisclosureProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      /* Today's look: the frosted card the picker uses too, header over a body that slides open
         and fades in behind the height. */
      :host {
        display: block;
        /* Lets block-size transition to and from auto below. */
        interpolate-size: allow-keywords;
      }

      details {
        overflow: hidden;
        border-radius: var(--_sv-radius);
        background: var(--_sv-surface-raised);
        box-shadow:
          inset 0 0 0 1px var(--_sv-glass-border),
          var(--_sv-shadow-sm);
      }

      summary {
        display: flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 2);
        padding: calc(var(--_sv-spacing) * 2.5) calc(var(--_sv-spacing) * 3.5);
        font-size: var(--_sv-text-sm);
        line-height: 1.25;
        font-weight: var(--_sv-font-weight-medium);
        color: var(--_sv-foreground);
        list-style: none;
        cursor: pointer;
      }
      summary::-webkit-details-marker {
        display: none;
      }
      summary:focus-visible {
        outline: 2px solid var(--_sv-ring);
        outline-offset: -2px;
        border-radius: var(--_sv-radius);
      }
      .heading {
        flex: 1;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chevron {
        transition: transform var(--_sv-duration) var(--_sv-ease);
      }
      details[open] .chevron {
        transform: rotate(-180deg);
      }

      details::details-content {
        block-size: 0;
        overflow: clip;
        transition:
          block-size var(--_sv-duration) var(--_sv-ease),
          content-visibility var(--_sv-duration) allow-discrete;
      }
      details[open]::details-content {
        block-size: auto;
      }
      @media (prefers-reduced-motion: reduce) {
        details::details-content {
          transition: none;
        }
      }

      .content {
        padding: 0 calc(var(--_sv-spacing) * 3.5) calc(var(--_sv-spacing) * 3);
        font-size: var(--_sv-text-xs);
        line-height: 1.375;
        color: var(--_sv-muted-foreground);
        /* Out fast, so the content is gone before the closing height clips it; in just behind
           the height, so it has somewhere to arrive. */
        opacity: 0;
        transition: opacity 100ms ease-out;
      }
      details[open] .content {
        opacity: 1;
        transition: opacity 200ms ease-out 75ms;
      }
    `,
  ];

  static override properties = {
    heading: {},
    open: { type: Boolean, reflect: true },
    controlled: { type: Boolean },
  };

  declare heading: string | undefined;
  declare open: boolean;
  declare controlled: boolean;

  constructor() {
    super();
    this.heading = undefined;
    this.open = false;
    this.controlled = false;
  }

  get #details(): HTMLDetailsElement | null {
    return this.renderRoot.querySelector("details");
  }

  /** @internal The summary remains measurable while its content is expanded. */
  [panelRestingSize]() {
    const summary = this.renderRoot.querySelector<HTMLElement>("summary");
    return {
      blockSize: summary ? measuredBlockSize(summary) : 0,
      targets: summary ? [summary] : [],
    };
  }

  protected override updated(changed: PropertyValues<this>): void {
    const details = this.#details;
    if (changed.has("open") && details && details.open !== this.open) {
      details.open = this.open;
    }
    notifyPanelRestingSize(this);
  }

  /**
   * The native element changed: a press, the keyboard, or find-in-page. Mirror it and report
   * it. A change that came from setting `open` already matches, so it reports nothing.
   */
  readonly #onToggle = (event: Event): void => {
    const details = this.#details;
    if (!details || event.target !== details || details.open === this.open) {
      return;
    }
    const { open } = details;
    if (this.controlled) {
      details.open = this.open;
    } else {
      this.open = open;
    }
    this.dispatchEvent(
      new CustomEvent<SvToggleDetail>("sv-toggle", {
        detail: { open },
        bubbles: true,
        composed: true,
      }),
    );
  };

  readonly #onSummaryClick = (event: MouseEvent): void => {
    if (!this.controlled) {
      return;
    }
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent<SvToggleDetail>("sv-toggle", {
        detail: { open: !this.open },
        bubbles: true,
        composed: true,
      }),
    );
  };

  protected override render() {
    return html`<details part="card" @toggle=${this.#onToggle}>
      <summary part="summary" @click=${this.#onSummaryClick}>
        <span class="heading">${this.heading}</span>
        <slot name="trailing"></slot>
        <sv-icon part="chevron" class="chevron" name="chevron-down" size="sm"></sv-icon>
      </summary>
      <div part="content" class="content"><slot></slot></div>
    </details>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-disclosure": SvDisclosure;
  }
  interface HTMLElementEventMap {
    "sv-toggle": CustomEvent<SvToggleDetail>;
  }
}
