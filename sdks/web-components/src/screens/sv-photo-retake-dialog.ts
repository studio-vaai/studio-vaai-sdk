import { css, html } from "lit";

import type { SvCancelDetail } from "../components/alert-dialog/sv-alert-dialog.js";

import { SvElement } from "../internal/ui-element.js";
import { photoRetakeMessages } from "./photo-retake/messages.js";

export interface SvPhotoRetakeDialogProps {
  /** Show the confirmation. Set to false after handling retake or cancellation. */
  open?: boolean | undefined;
}

export type SvPhotoRetakeActionDetail =
  | { action: "retake" }
  /** Cancellation source: button or Escape. */
  | { action: "cancel"; reason: SvCancelDetail["reason"] };

/**
 * Confirmation before replacing a camera photo.
 * @fires sv-photo-retake-action - Retake or cancellation requested.
 */
export class SvPhotoRetakeDialog extends SvElement implements SvPhotoRetakeDialogProps {
  protected override readonly usesMessages = true;
  static override styles = css`
    :host {
      display: contents;
    }
  `;
  static override properties = { open: { type: Boolean } };

  declare open: boolean;

  constructor() {
    super();
    this.open = false;
  }

  #act(detail: SvPhotoRetakeActionDetail): void {
    if (!this.open) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SvPhotoRetakeActionDetail>("sv-photo-retake-action", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  readonly #onConfirm = (event: Event): void => {
    event.stopPropagation();
    this.#act({ action: "retake" });
  };

  readonly #onCancel = (event: CustomEvent<SvCancelDetail>): void => {
    event.stopPropagation();
    this.#act({ action: "cancel", reason: event.detail.reason });
  };

  protected override render() {
    const copy = photoRetakeMessages(this.ui);
    return html`<sv-alert-dialog
      lang=${this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale}
      .open=${this.open}
      .heading=${copy.title}
      .description=${copy.description}
      .confirmLabel=${copy.confirm}
      .cancelLabel=${copy.cancel}
      @sv-confirm=${this.#onConfirm}
      @sv-cancel=${this.#onCancel}
    ></sv-alert-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-photo-retake-dialog": SvPhotoRetakeDialog;
  }
  interface HTMLElementEventMap {
    "sv-photo-retake-action": CustomEvent<SvPhotoRetakeActionDetail>;
  }
}
