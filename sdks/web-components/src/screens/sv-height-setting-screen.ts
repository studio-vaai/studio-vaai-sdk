import { html, nothing } from "lit";

import type { SvScreenNavigation } from "../components/screen/sv-screen.js";
import type { SvChangeDetail } from "../events.js";
import type { SvImageCrop } from "../media/image-crop.js";
import type { SvImageFraming } from "../media/image-framing.js";

import { SvElement } from "../internal/ui-element.js";
import { photoImageFraming } from "../media/image-framing.js";
import { svBase } from "../styles/base.js";
import { svTokens } from "../styles/tokens.js";
import { heightSettingMessages } from "./height-setting/messages.js";
import { heightSettingStyles } from "./height-setting/styles.js";

export interface SvHeightSettingChangeDetail {
  field: "heightCm";
  value: number;
}

export interface SvHeightSettingActionDetail {
  action: "confirm" | "upload";
}

export interface SvHeightSettingScreenProps {
  /** Journey-supplied header availability. */
  navigation?: SvScreenNavigation | undefined;
  /** Block confirmation while a previous write cannot be safely replaced. */
  confirmDisabled?: boolean | undefined;
  /** Accessible status for the current operation. */
  statusMessage?: string | undefined;
  /** Shopper photo URL. */
  photoSrc?: string | undefined;
  photoLoadKey?: string | undefined;
  /** Visible rectangle returned by camera capture. Omit to show the whole photo. */
  photoCrop?: SvImageCrop | undefined;
  /** Caller-owned protected composition for this photo, after photoCrop. */
  photoFraming?: SvImageFraming | undefined;
  /** Host-supplied whole-centimeter height, from 140 to 220. No screen default. */
  heightCm: number | undefined;
  /** Saving height; locks the input, actions, and navigation. */
  busy?: boolean | undefined;
  /** Localized validation or save error. Unset or empty hides the message. */
  error?: string | undefined;
  /** Localized field validation; separate from upload/save failures. */
  heightError?: string | undefined;
}

/**
 * Photo review and height confirmation.
 * @fires sv-height-setting-change - Height change requested.
 * @fires sv-height-setting-action - Height confirmation or another photo requested.
 * @fires sv-back - Back requested.
 */
export class SvHeightSettingScreen extends SvElement implements SvHeightSettingScreenProps {
  protected override readonly usesMessages = true;
  static override styles = [svTokens, svBase, heightSettingStyles];
  static override properties = {
    navigation: { attribute: false },
    confirmDisabled: { attribute: false },
    statusMessage: { attribute: false },
    photoSrc: { attribute: "photo-src" },
    photoLoadKey: { attribute: false },
    photoCrop: { attribute: false },
    photoFraming: { attribute: false },
    heightCm: { type: Number, attribute: "height-cm" },
    busy: { type: Boolean },
    error: {},
    heightError: { attribute: "height-error" },
  };

  declare photoSrc: string | undefined;
  declare photoLoadKey: string | undefined;
  declare photoCrop: SvImageCrop | undefined;
  declare photoFraming: SvImageFraming | undefined;
  declare heightCm: number | undefined;
  declare busy: boolean;
  declare error: string | undefined;
  declare heightError: string | undefined;

  declare confirmDisabled: boolean | undefined;
  declare statusMessage: string | undefined;
  declare navigation: SvScreenNavigation | undefined;

  constructor() {
    super();
    this.photoSrc = undefined;
    this.photoCrop = undefined;
    this.photoFraming = undefined;
    this.heightCm = undefined;
    this.busy = false;
    this.error = undefined;
    this.heightError = undefined;
  }

  get #hasHeight(): boolean {
    return (
      this.heightCm !== undefined &&
      Number.isInteger(this.heightCm) &&
      this.heightCm >= 140 &&
      this.heightCm <= 220
    );
  }

  readonly #onHeightChange = (event: CustomEvent<SvChangeDetail>): void => {
    event.stopPropagation();
    const { value } = event.detail;
    if (this.busy || typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SvHeightSettingChangeDetail>("sv-height-setting-change", {
        detail: { field: "heightCm", value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  #commitEdit(): number | undefined {
    return this.renderRoot.querySelector("sv-height-input")?.commitEdit();
  }

  async #confirm(): Promise<void> {
    const edited = this.#commitEdit();
    if (edited !== undefined && edited !== this.heightCm) {
      // Let the owner apply the edit and recompute confirmation availability.
      await Promise.resolve();
      if (!this.isConnected || edited !== this.heightCm) {
        return;
      }
    }
    this.#act("confirm");
  }

  #act(action: SvHeightSettingActionDetail["action"]): void {
    if (
      this.busy ||
      (action === "confirm" && (this.confirmDisabled === true || !this.#hasHeight))
    ) {
      return;
    }
    if (action === "upload") {
      this.#commitEdit();
    }
    this.dispatchEvent(
      new CustomEvent<SvHeightSettingActionDetail>("sv-height-setting-action", {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override render() {
    const copy = heightSettingMessages(this.ui);
    return html`<sv-screen
      .navigation=${this.navigation}
      @sv-back=${() => {
        this.#commitEdit();
      }}
      lang=${this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale}
      .heading=${copy.title}
      .description=${copy.subtitle}
      .busy=${this.busy}
      .statusMessage=${this.statusMessage ?? (this.busy ? copy.saving : "")}
      panel-align="center"
    >
      <sv-image
        slot="stage"
        .src=${this.photoSrc}
        .loadKey=${this.photoLoadKey}
        .alt=${this.ui.text("photo.reviewAlt")}
        .crop=${this.photoCrop}
        .framing=${photoImageFraming(this.photoFraming)}
      ></sv-image>
      <div class="picker">
        <p class="sv-field-label height-label">${copy.heightLabel}</p>
        ${
          this.#hasHeight
            ? html`<sv-height-input
                .validationError=${this.heightError}
                .value=${this.heightCm}
                .label=${copy.heightLabel}
                .disabled=${this.busy}
                @sv-change=${this.#onHeightChange}
              ></sv-height-input>`
            : nothing
        }
      </div>
      <div slot="before-actions">
        <slot name="recovery"></slot>
        ${this.error === undefined || this.error === "" ? nothing : html`<sv-message class="error">${this.error}</sv-message>`}
      </div>
      <sv-button
        slot="primary"
        .busy=${this.busy}
        .disabled=${this.busy || this.confirmDisabled === true || !this.#hasHeight}
        @click=${() => {
          void this.#confirm();
        }}
        >${copy.confirm}</sv-button
      >
      <sv-button
        slot="secondary"
        variant="ghost"
        .disabled=${this.busy}
        @click=${() => {
          this.#act("upload");
        }}
        >${copy.upload}</sv-button
      >
    </sv-screen>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-height-setting-screen": SvHeightSettingScreen;
  }
  interface HTMLElementEventMap {
    "sv-height-setting-change": CustomEvent<SvHeightSettingChangeDetail>;
    "sv-height-setting-action": CustomEvent<SvHeightSettingActionDetail>;
  }
}
