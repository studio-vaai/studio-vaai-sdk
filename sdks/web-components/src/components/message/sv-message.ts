import { css, html, nothing } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_MESSAGE_VARIANTS = ["destructive", "neutral"] as const;
export type SvMessageVariant = (typeof SV_MESSAGE_VARIANTS)[number];

export const SV_MESSAGE_LAYOUTS = ["inline", "card"] as const;
export type SvMessageLayout = (typeof SV_MESSAGE_LAYOUTS)[number];

export interface SvMessageProps {
  /**
   * `destructive` is an error: red, with the alert icon, announced right away. `neutral` is
   * information: gray, with the info icon, announced politely.
   */
  variant?: SvMessageVariant | undefined;
  /**
   * `inline` is a line under a control, e.g. "Try-on in 28/32 failed". `card` is a box, for a
   * failure that stops the screen or a hint (e.g. the camera's distance hint).
   */
  layout?: SvMessageLayout | undefined;
  /** Show static guidance without a live announcement. */
  silent?: boolean | undefined;
}

/**
 * `<sv-message>` — an error or a piece of information with its icon: a line, or with
 * `layout="card"` a box.
 *
 * Screen readers announce a `destructive` message right away (as an alert) and a `neutral` one
 * politely (as a status) when it appears.
 *
 * @slot - The message.
 * @csspart message - The line or box.
 * @csspart icon - The message icon.
 */
export class SvMessage extends SvElement implements SvMessageProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
      }
      .message {
        display: flex;
        align-items: flex-start;
        gap: calc(var(--_sv-spacing) * 1.5);
        min-inline-size: 0;
        font-size: var(--_sv-text-sm);
        line-height: 1.375;
        color: var(--_sv-destructive);
      }
      sv-icon {
        flex: none;
        --_sv-icon-size: calc(var(--_sv-spacing) * 3.5);
        margin-block-start: calc(var(--_sv-spacing) * 0.75);
      }
      .text {
        flex: 1;
        min-inline-size: 0;
      }
      :host(:not([layout="card"], [variant="neutral"])) .message {
        font-size: var(--_sv-text-xs);
      }
      :host(:not([layout="card"], [variant="neutral"])) sv-icon {
        --_sv-icon-size: calc(var(--_sv-spacing) * 3);
        --_sv-icon-stroke: 1.5;
        margin-block-start: calc(var(--_sv-spacing) * 0.5);
      }
      :host([variant="neutral"]) .message {
        color: var(--_sv-muted-foreground);
      }

      :host([layout="card"]) .message {
        gap: calc(var(--_sv-spacing) * 2.5);
        padding: calc(var(--_sv-spacing) * 3) calc(var(--_sv-spacing) * 3.5);
        border: 1px solid color-mix(in srgb, var(--_sv-destructive) 65%, transparent);
        border-radius: var(--_sv-radius);
        background: var(--_sv-surface-raised);
        color: var(--_sv-foreground);
      }
      :host([layout="card"]) sv-icon {
        --_sv-icon-size: calc(var(--_sv-spacing) * 4);
        margin-block-start: calc(var(--_sv-spacing) * 0.25);
        color: var(--_sv-destructive);
      }
      :host([layout="card"][variant="neutral"]) .message {
        border-color: transparent;
        background: var(--_sv-surface-raised);
      }
      :host([layout="card"][variant="neutral"]) sv-icon {
        color: var(--_sv-muted-foreground);
      }
    `,
  ];

  static override properties = {
    variant: { reflect: true },
    layout: { reflect: true },
    silent: { type: Boolean },
  };

  /** Unset renders `destructive`. */
  declare variant: SvMessageVariant | undefined;
  /** Unset renders `inline`. */
  declare layout: SvMessageLayout | undefined;
  declare silent: boolean;

  constructor() {
    super();
    this.variant = undefined;
    this.layout = undefined;
    this.silent = false;
  }

  protected override render() {
    const info = this.variant === "neutral";
    const liveRole = info ? "status" : "alert";
    return html`<div part="message" class="message" role=${this.silent ? nothing : liveRole}>
      <sv-icon part="icon" name=${info ? "info" : "circle-alert"}></sv-icon>
      <span class="text"><slot></slot></span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-message": SvMessage;
  }
}
