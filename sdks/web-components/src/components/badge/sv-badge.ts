import { css, html } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_BADGE_VARIANTS = ["neutral", "positive", "caution", "destructive"] as const;
export type SvBadgeVariant = (typeof SV_BADGE_VARIANTS)[number];

export interface SvBadgeProps {
  /**
   * `positive` for a recommendation or good fit, `caution` for a borderline fit, `destructive`
   * for a size that will not fit.
   */
  variant?: SvBadgeVariant | undefined;
}

/**
 * `<sv-badge>` — a short status label, e.g. "Recommended M".
 *
 * Shows its slotted text in a pill colored by `variant`.
 *
 * @slot - The label.
 * @csspart badge - The pill.
 */
export class SvBadge extends SvElement implements SvBadgeProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: var(--_sv-spacing);
        padding-block: calc(var(--_sv-spacing) * 0.5);
        padding-inline: calc(var(--_sv-spacing) * 2);
        border-radius: var(--_sv-radius-full);
        font-size: var(--_sv-text-xs);
        line-height: var(--_sv-text-xs--line-height);
        font-weight: var(--_sv-font-weight-medium);
        white-space: nowrap;
        background: var(--_sv-muted);
        color: var(--_sv-foreground);
      }
      :host([variant="positive"]) .badge {
        background: var(--_sv-positive-muted);
        color: var(--_sv-positive-foreground);
      }
      :host([variant="caution"]) .badge {
        background: var(--_sv-caution-muted);
        color: var(--_sv-caution-foreground);
      }
      :host([variant="destructive"]) .badge {
        background: var(--_sv-destructive-muted);
        color: var(--_sv-destructive-foreground);
      }
    `,
  ];

  static override properties = {
    variant: { reflect: true },
  };

  /** Unset renders `neutral`. */
  declare variant: SvBadgeVariant | undefined;

  constructor() {
    super();
    this.variant = undefined;
  }

  protected override render() {
    return html`<span part="badge" class="badge"><slot></slot></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-badge": SvBadge;
  }
}
