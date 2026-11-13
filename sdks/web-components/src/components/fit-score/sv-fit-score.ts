import { css, html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { SvToggleDetail } from "../disclosure/sv-disclosure.js";

import { fitScoreGradient } from "../../internal/fit-ramp.js";
import { LiveStatus } from "../../internal/live-status.js";
import {
  measuredBlockSize,
  notifyPanelRestingSize,
  panelRestingSize,
} from "../../internal/panel-layout.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvFitScoreProps {
  /** 0–100. Colors the bar from red at 0 through amber at 50 to green at 100. */
  score?: number | undefined;
  /** What the score is for, e.g. "Fit Score for S". */
  label?: string | undefined;
  /**
   * The intended fit in a sentence, shown when open. Without it the bar has nothing to open
   * into: no chevron, not pressable.
   */
  description?: string | undefined;
  /** Additional content controlled by this disclosure, even without a description. */
  expandable?: boolean | undefined;
  /** Opened into the card. Only the owner changes it: a press asks with `sv-toggle`. */
  open?: boolean | undefined;
  /**
   * The score couldn't be fetched: the same place shows `label` (e.g. "Fit score
   * unavailable") with a retry button instead of a score.
   */
  failed?: boolean | undefined;
  /** Waiting for this result's fit information; shows label and spinner without a score or actions. */
  loading?: boolean | undefined;
  /** A retry is in flight: the retry button is disabled. */
  busy?: boolean | undefined;
  /** The accessible name of the retry button. */
  retryLabel?: string | undefined;
  /** Set false when this failed score cannot be retried. */
  retryable?: boolean | undefined;
}

/**
 * `<sv-fit-score>` — the fit score: a bar with a label and the percentage, colored from red to
 * green by `score`, that opens into a card with `description`.
 *
 * A press on the bar fires `sv-toggle` with the state asked for; it opens and closes, animated,
 * only when the owner sets `open`. Without `description` there is nothing to open and the bar
 * can't be pressed. With `failed` it shows `label` with a retry button in the same place, which
 * fires `sv-retry`; `busy` disables it while a retry runs.
 * With `loading`, that place shows `label` and a spinner, with no score or interactive controls.
 *
 * @fires sv-toggle - The bar was pressed; `detail.open` is the state asked for.
 * @fires sv-retry - The retry button was pressed.
 * @csspart bar - The bar (also when failed).
 * @csspart score - The percentage.
 */
export class SvFitScore extends SvElement implements SvFitScoreProps {
  readonly #status = new LiveStatus(this, () => {
    if (this.loading || this.failed) {
      return this.label ?? "";
    }
    return this.score === undefined
      ? ""
      : `${this.label ?? ""} ${Math.round(Math.min(100, Math.max(0, this.score)))}%`;
  });
  static override shadowRootOptions: ShadowRootInit = {
    ...SvElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    svTokens,
    svBase,
    css`
      /*
       * Opening animates only what changes: the card's height (the sentence's row, 0fr → 1fr,
       * which every engine animates, unlike height: auto), the sentence fading in, the
       * percentage's size and the chevron's turn. The label, the chevron's place and the
       * sentence's line breaks hold still: the percentage's column is reserved at its open
       * width, so the text column never changes width mid-animation.
       */
      :host {
        display: block;
        min-inline-size: 0;
      }

      .bar {
        appearance: none;
        margin: 0;
        border: 0;
        inline-size: 100%;
        display: flex;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 3);
        padding: calc(var(--_sv-spacing) * 2.5) calc(var(--_sv-spacing) * 3.5);
        border-radius: var(--_sv-radius);
        color: var(--_sv-foreground);
        font-family: inherit;
        text-align: start;
        overflow: hidden;
        cursor: pointer;
        outline: none;
        backdrop-filter: blur(2px);
      }
      .bar:disabled {
        cursor: default;
      }
      .bar:focus-visible {
        box-shadow: inset 0 0 0 2px var(--_sv-foreground);
      }

      .text {
        flex: 1;
        align-self: flex-start;
        min-inline-size: 0;
        display: flex;
        flex-direction: column;
      }
      .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_sv-text-sm);
        line-height: 1.25;
        min-block-size: calc(var(--_sv-text-sm) * 1.25);
        font-weight: var(--_sv-font-weight-medium);
      }
      .detail {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows var(--_sv-duration) var(--_sv-ease);
      }
      :host([open]) .detail {
        grid-template-rows: 1fr;
      }
      /* Out fast so the closing row never clips half a line; in just behind the height. */
      .detail-inner {
        min-block-size: 0;
        overflow: hidden;
        font-size: var(--_sv-text-sm);
        line-height: 1.375;
        opacity: 0;
        transition: opacity 100ms ease-out;
      }
      .detail-inner::before {
        content: "";
        display: block;
        block-size: calc(var(--_sv-spacing) * 1);
      }
      :host([open]) .detail-inner {
        opacity: 1;
        transition: opacity 200ms ease-out 75ms;
      }

      /* Reserved at its open width and right-aligned: growing it never narrows the text. */
      .score {
        flex: none;
        min-inline-size: calc(var(--_sv-text-4xl) * 2.5);
        text-align: end;
        line-height: 1;
        font-size: var(--_sv-text-base);
        font-weight: var(--_sv-font-weight-semibold);
        font-variant-numeric: tabular-nums;
        transition:
          font-size var(--_sv-duration) var(--_sv-ease),
          translate var(--_sv-duration) var(--_sv-ease);
      }
      /* Open, the big percentage sits closer to the chevron; a translate, so nothing reflows. */
      :host([open]) .score {
        font-size: var(--_sv-text-4xl);
        font-weight: var(--_sv-font-weight-medium);
        translate: calc(var(--_sv-spacing) * 1.5) 0;
      }

      /* Level with the label's line in both states, so it only turns. */
      .chevron {
        flex: none;
        align-self: flex-start;
        margin-block-start: calc((var(--_sv-text-sm) * 1.25 - var(--_sv-spacing) * 3) / 2);
        transform: rotate(-180deg);
        transition: transform var(--_sv-duration) var(--_sv-ease);
      }
      :host([open]) .chevron {
        transform: none;
      }

      /* ---------- Failed ---------- */
      .bar.failed,
      .bar.loading {
        gap: calc(var(--_sv-spacing) * 2);
        background: var(--_sv-surface-raised);
        backdrop-filter: blur(12px);
        cursor: default;
      }
      .alert {
        flex: none;
        color: var(--_sv-destructive);
      }
      /* Same label as the score bar, so the slot keeps its height when the score fails. */
      .failed .label,
      .loading .label {
        flex: 1;
      }
      .loading-spinner {
        flex: none;
      }
      .retry {
        appearance: none;
        margin: 0;
        padding: 0;
        border: 0;
        flex: none;
        display: grid;
        place-items: center;
        inline-size: calc(var(--_sv-spacing) * 6);
        block-size: calc(var(--_sv-spacing) * 6);
        /* A 24px target that adds no height: it overhangs the text line into the padding. */
        margin-block: calc(var(--_sv-spacing) * -1.5);
        margin-inline-end: calc(var(--_sv-spacing) * -1.5);
        border-radius: var(--_sv-radius-full);
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .retry:hover:not(:disabled) {
        opacity: 0.7;
      }
      .retry:focus-visible {
        outline: 2px solid var(--_sv-ring);
      }
      .retry:disabled {
        cursor: default;
        opacity: 0.4;
      }
    `,
  ];

  static override properties = {
    score: { type: Number },
    label: {},
    description: {},
    expandable: { type: Boolean },
    open: { type: Boolean, reflect: true },
    failed: { type: Boolean, reflect: true },
    loading: { type: Boolean, reflect: true },
    busy: { type: Boolean, reflect: true },
    retryable: { attribute: false },
    retryLabel: { attribute: "retry-label" },
  };

  declare score: number | undefined;
  declare label: string | undefined;
  declare description: string | undefined;
  declare expandable: boolean;
  declare open: boolean;
  declare failed: boolean;
  declare loading: boolean;
  declare busy: boolean;
  declare retryable: boolean | undefined;
  declare retryLabel: string | undefined;

  constructor() {
    super();
    this.score = undefined;
    this.label = undefined;
    this.description = undefined;
    this.expandable = false;
    this.open = false;
    this.failed = false;
    this.loading = false;
    this.busy = false;
    this.retryLabel = undefined;
  }

  /** @internal Reserve the animated bar height, with a common minimum for all score states. */
  [panelRestingSize]() {
    const bar = this.renderRoot.querySelector<HTMLElement>(".bar");
    const label = this.renderRoot.querySelector<HTMLElement>(".label");
    if (!bar || !label) {
      return { blockSize: 0, targets: [] };
    }
    const style = getComputedStyle(bar);
    const padding =
      Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd);
    const collapsed = measuredBlockSize(label) + (Number.isFinite(padding) ? padding : 0);
    return { blockSize: Math.max(collapsed, measuredBlockSize(bar)), targets: [bar, label] };
  }

  protected override updated(): void {
    notifyPanelRestingSize(this);
  }

  readonly #onToggle = (): void => {
    if (this.loading || this.failed) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SvToggleDetail>("sv-toggle", {
        detail: { open: !this.open },
        bubbles: true,
        composed: true,
      }),
    );
  };

  readonly #onRetry = (): void => {
    if (this.loading) {
      return;
    }
    this.dispatchEvent(new CustomEvent("sv-retry", { bubbles: true, composed: true }));
  };

  #renderFailed() {
    return html`<div part="bar" class="bar failed">
      <sv-icon class="alert" name="circle-alert" size="sm"></sv-icon>
      <span class="label">${this.label}</span>
      ${
        this.retryable === false
          ? nothing
          : html`<button
              class="retry"
              type="button"
              aria-label=${this.retryLabel ?? nothing}
              ?disabled=${this.busy}
              @click=${this.#onRetry}
            >
              <sv-icon name="rotate-cw" size="sm"></sv-icon>
            </button>`
      }
    </div>`;
  }

  protected override render() {
    return html`<span class="sv-sr-only" role="status" aria-atomic="true">${this.#status.text}</span
      >${this.#renderBody()}`;
  }

  #renderBody() {
    if (this.loading) {
      return html`<div part="bar" class="bar loading">
        <span class="label">${this.label}</span>
        <sv-spinner class="loading-spinner" size="sm"></sv-spinner>
      </div>`;
    }
    if (this.failed) {
      return this.#renderFailed();
    }
    const score = Math.round(Math.min(100, Math.max(0, this.score ?? 0)));
    const openable = this.expandable || (this.description !== undefined && this.description !== "");
    let expanded: "true" | "false" | typeof nothing = nothing;
    if (openable) {
      expanded = this.open ? "true" : "false";
    }
    return html`<button
      part="bar"
      class="bar"
      type="button"
      style=${styleMap({ backgroundImage: fitScoreGradient(score, this.ui.snapshot.appearance) })}
      aria-expanded=${expanded}
      ?disabled=${!openable}
      @click=${this.#onToggle}
    >
      <span class="text">
        <span class="label">${this.label}</span>
        ${
          openable
            ? html`<span class="detail" ?inert=${!this.open}
                ><span class="detail-inner">${this.description}</span></span
              >`
            : nothing
        }
      </span>
      <span part="score" class="score">${score}%</span>
      ${
        openable ? html`<sv-icon class="chevron" name="chevron-down" size="sm"></sv-icon>` : nothing
      }
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-fit-score": SvFitScore;
  }
  interface HTMLElementEventMap {
    "sv-retry": CustomEvent<undefined>;
  }
}
