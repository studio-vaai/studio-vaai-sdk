import type { PropertyValues } from "lit";

import { css, html } from "lit";

import {
  closeNow,
  closeWithTransition,
  consumeOwnClose,
  showModal,
  unlockPageScroll,
} from "../../internal/modal.js";
import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvCancelDetail {
  /** `escape` for the Esc key, `button` for the cancel button. */
  reason: "escape" | "button";
}

export interface SvAlertDialogProps {
  /** Shown above everything, the flow's dialog included. Only the owner changes it. */
  open?: boolean | undefined;
  /** The question, already translated. Names the dialog. */
  heading?: string | undefined;
  /** What happens if the shopper confirms. Describes the dialog. */
  description?: string | undefined;
  /** Says the action ("Retake photo"), not "OK". */
  confirmLabel?: string | undefined;
  /** Says what stays ("Keep this photo"). Has focus when the dialog opens. */
  cancelLabel?: string | undefined;
}

/**
 * `<sv-alert-dialog>` — asks the shopper a question that must be answered before going on, e.g.
 * whether to retake a photo.
 *
 * Shows `heading`, `description` and two buttons in a centered box above everything, including
 * an open `sv-dialog`; focus starts on the cancel button. It never closes itself: the confirm
 * button fires `sv-confirm`, the cancel button and Esc fire `sv-cancel`, and it stays open until
 * the owner sets `open` to false. A click on the backdrop does nothing.
 *
 * @fires sv-confirm - The confirm button was pressed.
 * @fires sv-cancel - The cancel button or Esc was pressed; `detail.reason` says which.
 * @csspart panel - The box.
 * @csspart heading - The question.
 * @csspart description - The text under it.
 * @csspart actions - The row of buttons.
 */
export class SvAlertDialog extends SvElement implements SvAlertDialogProps {
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: contents;
      }
      .panel {
        position: fixed;
        inset: 0;
        margin: auto;
        inline-size: min(calc(var(--_sv-root) * 28), calc(100% - var(--_sv-spacing) * 8));
        block-size: fit-content;
        max-block-size: calc(100dvh - var(--_sv-spacing) * 8);
        padding: calc(var(--_sv-spacing) * 6);
        border: 0;
        border-radius: var(--_sv-radius-xl);
        background: var(--_sv-surface-raised);
        color: var(--_sv-foreground);
        box-shadow: var(--_sv-shadow-lg);
        font-family: inherit;
        overflow: auto;
        container-type: inline-size;
        transition:
          opacity var(--_sv-duration-fast) var(--_sv-ease),
          transform var(--_sv-duration) var(--_sv-ease);
      }
      .panel[open] {
        display: grid;
        gap: calc(var(--_sv-spacing) * 2);
      }
      .panel[data-closing] {
        opacity: 0;
        transform: scale(0.96);
      }
      @starting-style {
        .panel[open] {
          opacity: 0;
          transform: scale(0.96);
        }
      }
      .panel::backdrop {
        background: var(--_sv-backdrop, rgb(0 0 0 / 0.45));
        transition: opacity var(--_sv-duration-fast, 150ms) var(--_sv-ease, ease);
      }
      .panel[data-closing]::backdrop {
        opacity: 0;
      }
      @starting-style {
        .panel[open]::backdrop {
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel::backdrop {
          transition-duration: 1ms;
        }
      }

      h2 {
        margin: 0;
        font-size: var(--_sv-text-base);
        line-height: var(--_sv-text-base--line-height);
        font-weight: var(--_sv-font-weight-semibold);
        text-wrap: balance;
      }
      p {
        margin: 0;
        font-size: var(--_sv-text-sm);
        line-height: var(--_sv-text-sm--line-height);
        color: var(--_sv-muted-foreground);
      }
      .actions {
        display: flex;
        flex-wrap: wrap-reverse;
        justify-content: flex-end;
        align-items: center;
        gap: calc(var(--_sv-spacing) * 2);
        margin-block-start: calc(var(--_sv-spacing) * 4);
      }
      /* Narrow: full-width buttons, confirm on top. */
      @container (inline-size < 20rem) {
        .actions {
          flex-direction: column-reverse;
          align-items: stretch;
        }
      }
    `,
  ];

  static override properties = {
    open: { type: Boolean, reflect: true },
    heading: {},
    description: {},
    confirmLabel: { attribute: "confirm-label" },
    cancelLabel: { attribute: "cancel-label" },
  };

  declare open: boolean;
  declare heading: string | undefined;
  declare description: string | undefined;
  declare confirmLabel: string | undefined;
  declare cancelLabel: string | undefined;

  constructor() {
    super();
    this.open = false;
    this.heading = undefined;
    this.description = undefined;
    this.confirmLabel = undefined;
    this.cancelLabel = undefined;
  }

  get #dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("dialog");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    const dialog = this.#dialog;
    if (dialog) {
      closeNow(dialog);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("open")) {
      return;
    }
    const dialog = this.#dialog;
    if (!dialog) {
      return;
    }
    if (this.open) {
      if (showModal(dialog)) {
        // The button that loses nothing. Explicit, since autofocus does not reach into a
        // focus-delegating custom element in every engine.
        this.renderRoot.querySelector<HTMLElement>(".cancel")?.focus();
      }
    } else {
      closeWithTransition(dialog);
    }
  }

  #cancel(reason: SvCancelDetail["reason"]): void {
    this.dispatchEvent(
      new CustomEvent<SvCancelDetail>("sv-cancel", {
        detail: { reason },
        bubbles: true,
        composed: true,
      }),
    );
  }

  readonly #onCancel = (event: Event): void => {
    event.preventDefault();
    this.#cancel("escape");
  };

  /** See `sv-dialog`: a close the browser forced; report it and reopen if still open. */
  readonly #onClose = (): void => {
    const dialog = this.#dialog;
    if (!dialog || consumeOwnClose(dialog)) {
      return;
    }
    unlockPageScroll();
    this.#cancel("escape");
    queueMicrotask(() => {
      if (this.open) {
        showModal(dialog);
      }
    });
  };

  readonly #onConfirm = (): void => {
    this.dispatchEvent(new CustomEvent("sv-confirm", { bubbles: true, composed: true }));
  };

  readonly #onCancelButton = (): void => {
    this.#cancel("button");
  };

  protected override render() {
    return html`<dialog
      part="panel"
      class="panel"
      role="alertdialog"
      aria-labelledby="heading"
      aria-describedby="description"
      @cancel=${this.#onCancel}
      @close=${this.#onClose}
    >
      <h2 id="heading" part="heading">${this.heading}</h2>
      <p id="description" part="description">${this.description}</p>
      <div class="actions" part="actions">
        <sv-button class="cancel" variant="ghost" @click=${this.#onCancelButton}>
          ${this.cancelLabel}
        </sv-button>
        <sv-button class="confirm" @click=${this.#onConfirm}> ${this.confirmLabel} </sv-button>
      </div>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-alert-dialog": SvAlertDialog;
  }
  interface HTMLElementEventMap {
    "sv-confirm": CustomEvent<undefined>;
    "sv-cancel": CustomEvent<SvCancelDetail>;
  }
}
