import { html, nothing } from "lit";

import type { SvToggleDetail } from "../components/disclosure/sv-disclosure.js";
import type { SvScreenNavigation } from "../components/screen/sv-screen.js";
import type { SvChangeDetail } from "../events.js";
import type { SvSessionIntroMessages } from "./session-intro/messages.js";

import { renderMessage } from "../internal/messages.js";
import { SvElement } from "../internal/ui-element.js";
import { svBase } from "../styles/base.js";
import { svTokens } from "../styles/tokens.js";
import { sessionIntroMessages } from "./session-intro/messages.js";
import { sessionIntroStyles } from "./session-intro/styles.js";

// These optional features default to true; an explicit HTML "false" disables them.
const defaultTrueBoolean = (value: string | null): boolean => value !== "false";

export interface SvSessionIntroChangeDetail {
  field: "consented" | "photoFactsOpen" | "withdrawalOpen";
  value: boolean;
}
export interface SvSessionIntroActionDetail {
  action: "upload" | "camera" | "consent-required";
}

export interface SvSessionIntroScreenProps {
  /** Journey-supplied header availability. */
  navigation?: SvScreenNavigation | undefined;
  /** Use the supplied primary slot for a session recovery action. */
  recoveryOnly?: boolean | undefined;
  /** Whether the shopper has consented. */
  consented?: boolean | undefined;
  /** Require consent and show its notice. HTML accepts "false" to disable. */
  consentRequired?: boolean | undefined;
  /** Work in progress; locks consent, actions, and navigation. Disclosures remain readable. */
  busy?: boolean | undefined;
  /** Expand the photo-handling disclosure. */
  photoFactsOpen?: boolean | undefined;
  /** Expand the withdrawal and privacy notice. */
  withdrawalOpen?: boolean | undefined;
  /** Localized validation or upload error. Unset or empty hides the message. */
  error?: string | undefined;
  /** Localized consent validation, shown above the actions and associated with the checkbox. */
  consentError?: string | undefined;
}

/**
 * Consent and privacy disclosures with photo upload and camera actions.
 * @fires sv-session-intro-change - Consent or disclosure change requested.
 * @fires sv-session-intro-action - Upload, camera, or consent validation requested.
 * @fires sv-back - Back requested.
 */
export class SvSessionIntroScreen extends SvElement implements SvSessionIntroScreenProps {
  protected override readonly usesMessages = true;
  static override styles = [svTokens, svBase, sessionIntroStyles];
  static override properties = {
    navigation: { attribute: false },
    recoveryOnly: { attribute: false },
    consented: { type: Boolean },
    consentRequired: {
      type: Boolean,
      attribute: "consent-required",
      converter: defaultTrueBoolean,
    },
    busy: { type: Boolean },
    photoFactsOpen: { type: Boolean, attribute: "photo-facts-open" },
    withdrawalOpen: { type: Boolean, attribute: "withdrawal-open" },
    error: {},
    flowControlled: { attribute: false },
    consentError: { attribute: "consent-error" },
  };
  declare consented: boolean;
  declare consentRequired: boolean;
  declare busy: boolean;
  declare photoFactsOpen: boolean;
  declare withdrawalOpen: boolean;
  declare error: string | undefined;
  declare flowControlled: boolean | undefined;
  declare consentError: string | undefined;

  declare recoveryOnly: boolean | undefined;
  declare navigation: SvScreenNavigation | undefined;

  constructor() {
    super();
    this.consented = false;
    this.consentRequired = true;
    this.busy = false;
    this.photoFactsOpen = false;
    this.withdrawalOpen = false;
    this.error = undefined;
    this.consentError = undefined;
  }

  #change(field: SvSessionIntroChangeDetail["field"], value: boolean): void {
    this.dispatchEvent(
      new CustomEvent<SvSessionIntroChangeDetail>("sv-session-intro-change", {
        detail: { field, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #act(action: "upload" | "camera"): void {
    if (this.busy) {
      return;
    }
    const requested =
      this.flowControlled !== true && this.consentRequired && !this.consented
        ? "consent-required"
        : action;
    this.dispatchEvent(
      new CustomEvent<SvSessionIntroActionDetail>("sv-session-intro-action", {
        detail: { action: requested },
        bubbles: true,
        composed: true,
      }),
    );
  }

  readonly #onConsent = (event: CustomEvent<SvChangeDetail>): void => {
    event.stopPropagation();
    if (!this.busy && typeof event.detail.value === "boolean") {
      this.#change("consented", event.detail.value);
    }
  };
  readonly #onPhotoFacts = (event: CustomEvent<SvToggleDetail>): void => {
    event.stopPropagation();
    this.#change("photoFactsOpen", event.detail.open);
  };
  readonly #onWithdrawal = (event: CustomEvent<SvToggleDetail>): void => {
    event.stopPropagation();
    this.#change("withdrawalOpen", event.detail.open);
  };

  /** Screen-specific sections stay private: they compose the shared controls, not new elements. */
  #renderPhotoPrivacy(copy: SvSessionIntroMessages) {
    return html`<sv-disclosure
      class="privacy"
      .heading=${copy.photoFactsTitle}
      .controlled=${true}
      .open=${this.photoFactsOpen}
      @sv-toggle=${this.#onPhotoFacts}
    >
      <sv-fact-list .items=${copy.photoFacts}></sv-fact-list>
    </sv-disclosure>`;
  }

  #renderConsent(copy: SvSessionIntroMessages) {
    if (!this.consentRequired) {
      return nothing;
    }
    return html`<div class="consent">
        <sv-checkbox
          .checked=${this.consented}
          .validationError=${this.consentError}
          .disabled=${this.busy}
          @sv-change=${this.#onConsent}
          >${copy.consent}</sv-checkbox
        >
        <sv-disclosure
          class="withdrawal"
          .heading=${copy.withdrawalLabel}
          .controlled=${true}
          .open=${this.withdrawalOpen}
          @sv-toggle=${this.#onWithdrawal}
          >${renderMessage(copy.withdrawalBody)}</sv-disclosure
        >
      </div>
      <p class="legal">${renderMessage(copy.legal)}</p>`;
  }

  #renderErrors() {
    const messages = [this.consentRequired ? this.consentError : undefined, this.error].filter(
      (message): message is string => typeof message === "string" && message !== "",
    );
    return messages.length === 0
      ? nothing
      : html`<div class="errors">
          ${messages.map((message) => html`<sv-message>${message}</sv-message>`)}
        </div>`;
  }

  protected override render() {
    const copy = sessionIntroMessages(this.ui);
    const blocked = this.consentRequired && !this.consented;
    return html`<sv-screen
      .navigation=${this.navigation}
      lang=${this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale}
      .heading=${copy.title}
      .busy=${this.busy}
      .statusMessage=${this.busy ? copy.busyLabel : ""}
      panel-align="center"
    >
      <span slot="description"
        ><span class="subtitle">${copy.subtitle}</span
        ><sv-powered-by class="header-credit"></sv-powered-by
      ></span>
      <div slot="stage" class="guide">
        <div class="guide-frame">
          <sv-photo-guide></sv-photo-guide>
          <sv-powered-by class="guide-credit"></sv-powered-by>
        </div>
      </div>
      <div class="panel">
        <sv-steps class="steps" .items=${copy.steps}></sv-steps>${this.#renderPhotoPrivacy(copy)}
      </div>
      <div slot="before-actions" class="before-actions">
        ${this.#renderConsent(copy)} ${this.#renderErrors()}<slot name="recovery"></slot>
      </div>
      ${
        this.recoveryOnly === true
          ? html`<slot name="primary" slot="primary"></slot>`
          : html`<sv-button
              slot="primary"
              .blocked=${blocked}
              .busy=${this.busy}
              .disabled=${this.busy}
              @click=${() => {
                this.#act("upload");
              }}
              >${copy.uploadLabel}</sv-button
            > `
      }
      ${
        this.recoveryOnly === true
          ? nothing
          : html`<sv-button
              slot="secondary"
              variant="ghost"
              .blocked=${blocked}
              .disabled=${this.busy}
              @click=${() => {
                this.#act("camera");
              }}
              >${copy.cameraLabel}</sv-button
            > `
      }
    </sv-screen>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-session-intro-screen": SvSessionIntroScreen;
  }
  interface HTMLElementEventMap {
    "sv-session-intro-change": CustomEvent<SvSessionIntroChangeDetail>;
    "sv-session-intro-action": CustomEvent<SvSessionIntroActionDetail>;
  }
}
