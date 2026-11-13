import { css, html } from "lit";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export const SV_FIT_CALLOUT_VARIANTS = ["positive", "caution", "destructive"] as const;
export type SvFitCalloutVariant = (typeof SV_FIT_CALLOUT_VARIANTS)[number];

export interface SvFitCalloutProps {
  /** The body area, e.g. "Sleeve length". */
  label?: string | undefined;
  /** How it fits there, e.g. "runs long". */
  description?: string | undefined;
  /** The dot: `positive` fits, `caution` runs tight, loose, short or long, `destructive` won't. */
  variant?: SvFitCalloutVariant | undefined;
  /** Raised with a deeper shadow, e.g. while its body point is hovered or pinned. */
  active?: boolean | undefined;
}

/**
 * `<sv-fit-callout>` — one fit verdict for a body area, e.g. "Sleeve length: runs long", with a
 * dot colored by `variant`.
 *
 * Only the card: placing it on the render and drawing a line to the body point is up to the
 * owner. `active` raises it, e.g. while its body point is hovered.
 *
 * @csspart card - The card.
 * @csspart dot - The colored dot.
 * @csspart label - The body-area label.
 * @csspart verdict - The fit description.
 */
export class SvFitCallout extends SvElement implements SvFitCalloutProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: inline-block;
        max-inline-size: 100%;
      }
      /*
       * Both lines are trimmed to their capitals and baseline, so the padding is the same 14px
       * from the card's edge to the letters all round, and the dot centers on the capitals.
       * Where \`text-box\` is unsupported the card is a few pixels taller.
       */
      /* At least 124px wide, so cards on one render line up whatever their text. */
      .card {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: calc(var(--_sv-spacing) * 31);
        gap: calc(var(--_sv-spacing) * 2.5);
        padding: calc(var(--_sv-spacing) * 3.5);
        border-radius: var(--_sv-radius-xl);
        background: var(--_sv-photo-overlay);
        color: var(--_sv-photo-overlay-foreground);
        box-shadow:
          inset 0 0 0 1px var(--_sv-glass-border),
          var(--_sv-shadow-md);
        transition:
          transform var(--_sv-duration) var(--_sv-ease),
          box-shadow var(--_sv-duration) var(--_sv-ease);
      }
      :host([active]) .card {
        transform: scale(1.03);
        box-shadow:
          inset 0 0 0 1px var(--_sv-glass-border),
          var(--_sv-shadow-lg);
      }
      .label,
      .verdict {
        min-inline-size: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1;
        font-weight: var(--_sv-font-weight-normal);
        text-box: trim-both cap alphabetic;
        /* Clip only sideways (for the ellipsis): umlauts and descenders reach past the trim. */
        overflow: clip visible;
      }
      .label {
        font-size: calc(var(--_sv-root) * 0.8125);
        font-weight: var(--_sv-font-weight-semibold);
      }
      .line {
        display: flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 1.5);
        min-inline-size: 0;
      }
      .verdict {
        font-size: calc(var(--_sv-root) * 0.6875);
        color: var(--_sv-photo-overlay-foreground);
      }
      .dot {
        flex: none;
        inline-size: calc(var(--_sv-spacing) * 2);
        block-size: calc(var(--_sv-spacing) * 2);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-positive);
      }
      :host([variant="caution"]) .dot {
        background: var(--_sv-caution);
      }
      :host([variant="destructive"]) .dot {
        background: var(--_sv-destructive);
      }
    `,
  ];

  static override properties = {
    label: {},
    description: {},
    variant: { reflect: true },
    active: { type: Boolean, reflect: true },
  };

  declare label: string | undefined;
  declare description: string | undefined;
  /** Unset renders `positive`. */
  declare variant: SvFitCalloutVariant | undefined;
  declare active: boolean;

  constructor() {
    super();
    this.label = undefined;
    this.description = undefined;
    this.variant = undefined;
    this.active = false;
  }

  protected override render() {
    return html`<div part="card" class="card">
      <span part="label" class="label">${this.label}</span>
      <span class="line">
        <span part="dot" class="dot" aria-hidden="true"></span>
        <span part="verdict" class="verdict">${this.description}</span>
      </span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-fit-callout": SvFitCallout;
  }
}
