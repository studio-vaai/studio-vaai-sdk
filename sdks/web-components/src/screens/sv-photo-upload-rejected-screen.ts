import { html, nothing } from "lit";

import type { SvScreenNavigation } from "../components/screen/sv-screen.js";
import type { SvImageCrop } from "../media/image-crop.js";
import type { SvImageFraming } from "../media/image-framing.js";

import { SvElement } from "../internal/ui-element.js";
import { photoImageFraming } from "../media/image-framing.js";
import { svBase } from "../styles/base.js";
import { svTokens } from "../styles/tokens.js";
import { photoUploadRejectedMessages } from "./photo-upload-rejected/messages.js";
import { photoUploadRejectedStyles } from "./photo-upload-rejected/styles.js";

export interface SvPhotoUploadRejectedActionDetail {
  action: "upload" | "guide";
}

export interface SvPhotoUploadRejectedScreenProps {
  /** Journey-supplied header availability. */
  navigation?: SvScreenNavigation | undefined;
  /** Rejected photo URL. Omit to show a placeholder. */
  photoSrc?: string | undefined;
  photoLoadKey?: string | undefined;
  /** Visible rectangle returned by camera capture. Omit to show the whole photo. */
  photoCrop?: SvImageCrop | undefined;
  /** Caller-owned protected composition for this photo, after photoCrop. */
  photoFraming?: SvImageFraming | undefined;
  /** Accessible status for the current operation. */
  statusMessage?: string | undefined;
  /** Retry in progress; locks navigation and actions. The rejection remains readable. */
  busy?: boolean | undefined;
  /** Localized rejection reason. Omit for the default; an empty string hides it. */
  error?: string | undefined;
}

/**
 * Photo rejection with another-photo and guidance actions.
 * @fires sv-photo-upload-rejected-action - Another photo or photo guidance requested.
 * @fires sv-back - Back requested.
 */
export class SvPhotoUploadRejectedScreen
  extends SvElement
  implements SvPhotoUploadRejectedScreenProps
{
  protected override readonly usesMessages = true;
  static override styles = [svTokens, svBase, photoUploadRejectedStyles];
  static override properties = {
    navigation: { attribute: false },
    photoSrc: { attribute: "photo-src" },
    photoLoadKey: { attribute: false },
    photoCrop: { attribute: false },
    photoFraming: { attribute: false },
    busy: { type: Boolean },
    statusMessage: { attribute: false },
    error: {},
  };

  declare photoSrc: string | undefined;
  declare photoLoadKey: string | undefined;
  declare photoCrop: SvImageCrop | undefined;
  declare photoFraming: SvImageFraming | undefined;
  declare busy: boolean;
  declare statusMessage: string | undefined;
  declare error: string | undefined;

  declare navigation: SvScreenNavigation | undefined;

  constructor() {
    super();
    this.photoSrc = undefined;
    this.photoCrop = undefined;
    this.photoFraming = undefined;
    this.busy = false;
    this.error = undefined;
  }

  #act(action: SvPhotoUploadRejectedActionDetail["action"]): void {
    if (this.busy) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SvPhotoUploadRejectedActionDetail>("sv-photo-upload-rejected-action", {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override render() {
    const copy = photoUploadRejectedMessages(this.ui);
    const error = this.error ?? copy.error;
    return html`<sv-screen
      .navigation=${this.navigation}
      lang=${this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale}
      .heading=${copy.title}
      .busy=${this.busy}
      .statusMessage=${this.statusMessage ?? (this.busy ? copy.uploading : "")}
      stage-layout="centered"
    >
      <span class="heading" slot="heading"
        ><sv-icon name="circle-alert"></sv-icon><span>${copy.title}</span></span
      >
      <sv-image
        slot="stage"
        .src=${this.photoSrc}
        .loadKey=${this.photoLoadKey}
        .alt=${this.ui.text("photo.rejectedAlt")}
        .crop=${this.photoCrop}
        .framing=${photoImageFraming(this.photoFraming)}
      ></sv-image>
      <div slot="before-actions">
        <slot name="recovery"></slot>
        ${error === "" ? nothing : html`<sv-message>${error}</sv-message>`}
      </div>
      <sv-button
        slot="primary"
        .busy=${this.busy}
        .disabled=${this.busy}
        @click=${() => {
          this.#act("upload");
        }}
        >${copy.upload}</sv-button
      >
      <sv-button
        slot="secondary"
        variant="ghost"
        .disabled=${this.busy}
        @click=${() => {
          this.#act("guide");
        }}
        >${copy.guide}</sv-button
      >
    </sv-screen>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-photo-upload-rejected-screen": SvPhotoUploadRejectedScreen;
  }
  interface HTMLElementEventMap {
    "sv-photo-upload-rejected-action": CustomEvent<SvPhotoUploadRejectedActionDetail>;
  }
}
