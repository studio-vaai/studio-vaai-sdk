import { html, nothing } from "lit";

import type { SvCameraCapture } from "../components/camera/sv-camera.js";
import type { SvScreenNavigation } from "../components/screen/sv-screen.js";
import type { SvImageCrop } from "../media/image-crop.js";
import type { SvImageFraming } from "../media/image-framing.js";
import type { PhotoCaptureMessages } from "./photo-capture/messages.js";

import { SvElement } from "../internal/ui-element.js";
import { photoImageFraming } from "../media/image-framing.js";
import { svBase } from "../styles/base.js";
import { svTokens } from "../styles/tokens.js";
import { photoCaptureMessages } from "./photo-capture/messages.js";
import { photoCaptureStyles } from "./photo-capture/styles.js";

export const SV_PHOTO_CAPTURE_STATES = [
  "permission",
  "live",
  "uploading",
  "denied",
  "unavailable",
  "error",
] as const;
export type SvPhotoCaptureState = (typeof SV_PHOTO_CAPTURE_STATES)[number];

export interface SvPhotoCaptureActionDetail {
  action:
    | "request-permission"
    | "start-timer"
    | "cancel-timer"
    | "retry"
    | "switch-camera"
    | "upload";
}

export interface SvPhotoCaptureScreenProps {
  /** Journey-supplied header availability. */
  navigation?: SvScreenNavigation | undefined;
  /** Localized status while preparing the session or acquiring a camera. */
  statusMessage?: string | undefined;
  /** Available camera inputs. The switch action appears while live when more than one is supplied. Property only. */
  cameras?: readonly Pick<MediaDeviceInfo, "deviceId">[] | undefined;
  /** When supplied, the flow owns switching and playback readiness. */
  canSwitchCamera?: boolean | undefined;
  canStartTimer?: boolean | undefined;
  /** Camera permission, capture, upload, or failure state. */
  state?: SvPhotoCaptureState | undefined;
  /** Live camera stream. Your application requests access and stops the tracks. */
  stream?: MediaStream | null | undefined;
  /** Seconds remaining on the timer. 0 hides the countdown. */
  countdownSeconds?: number | undefined;
  /** Timer duration shown on the start button, in seconds. */
  selfTimerDurationSeconds?: number | undefined;
  /** Captured JPEG URL, shown while uploading. The JPEG already includes mirroring. */
  photoSrc?: string | undefined;
  photoLoadKey?: string | undefined;
  /** Visible rectangle returned by camera capture. Omit to show the whole photo. */
  photoCrop?: SvImageCrop | undefined;
  /** Caller-owned protected composition for this photo, after photoCrop. */
  photoFraming?: SvImageFraming | undefined;
  /** Capture in progress; locks actions and navigation. Uploading state always locks interaction. */
  busy?: boolean | undefined;
  /** Whether the experience can switch to the photo library while camera access is pending. */
  canChoosePhoto?: boolean | undefined;
  /** Localized message for denied, unavailable, or error states. Omit to use the default message. */
  error?: string | undefined;
}

/**
 * Camera permission, self-timer capture, and upload preview.
 * @fires sv-photo-capture-action - Camera access, timer, retry, camera switch, or upload requested.
 * @fires sv-back - Back requested.
 */
export class SvPhotoCaptureScreen extends SvElement implements SvPhotoCaptureScreenProps {
  #previewStream: MediaStream | undefined;
  protected override readonly usesMessages = true;
  static override styles = [svTokens, svBase, photoCaptureStyles];
  static override properties = {
    navigation: { attribute: false },
    statusMessage: { attribute: false },
    state: {},
    stream: { attribute: false },
    countdownSeconds: { type: Number, attribute: "countdown-seconds" },
    selfTimerDurationSeconds: { type: Number, attribute: "self-timer-duration-seconds" },
    photoSrc: { attribute: "photo-src" },
    photoLoadKey: { attribute: false },
    photoCrop: { attribute: false },
    photoFraming: { attribute: false },
    busy: { type: Boolean },
    canChoosePhoto: { attribute: false },
    error: {},
    cameras: { attribute: false },
    canSwitchCamera: { attribute: false },
    canStartTimer: { attribute: false },
  };

  declare state: SvPhotoCaptureState;
  declare stream: MediaStream | null | undefined;
  declare countdownSeconds: number;
  declare selfTimerDurationSeconds: number;
  declare photoSrc: string | undefined;
  declare photoLoadKey: string | undefined;
  declare photoCrop: SvImageCrop | undefined;
  declare photoFraming: SvImageFraming | undefined;
  declare busy: boolean;
  declare canChoosePhoto: boolean | undefined;
  declare error: string | undefined;
  declare canSwitchCamera: boolean | undefined;
  declare canStartTimer: boolean | undefined;
  declare cameras: readonly Pick<MediaDeviceInfo, "deviceId">[];

  declare statusMessage: string | undefined;
  declare navigation: SvScreenNavigation | undefined;

  constructor() {
    super();
    this.state = "permission";
    this.stream = undefined;
    this.countdownSeconds = 0;
    this.selfTimerDurationSeconds = 10;
    this.photoSrc = undefined;
    this.photoCrop = undefined;
    this.photoFraming = undefined;
    this.busy = false;
    this.error = undefined;
    this.cameras = [];
  }

  get #hasMultipleCameras(): boolean {
    return this.canSwitchCamera ?? this.cameras.length > 1;
  }

  get #counting(): boolean {
    return this.state === "live" && this.countdownSeconds > 0;
  }

  get #timerReady(): boolean {
    return (
      this.canStartTimer ??
      (this.stream === undefined
        ? this.navigation === undefined
        : this.#previewStream === this.stream)
    );
  }

  get #primaryAction(): "request-permission" | "start-timer" | "cancel-timer" | "retry" {
    if (this.state === "permission") {
      return "request-permission";
    }
    if (this.state === "live" || this.state === "uploading") {
      return this.state === "live" && this.#counting ? "cancel-timer" : "start-timer";
    }
    return "retry";
  }

  #act(action: SvPhotoCaptureActionDetail["action"]): void {
    if (
      this.state === "uploading" ||
      (action === "start-timer" && !this.#timerReady) ||
      (this.busy && !(action === "upload" && this.canChoosePhoto === true))
    ) {
      return;
    }
    const allowed =
      action === this.#primaryAction ||
      (action === "upload" && (!this.#counting || this.navigation !== undefined)) ||
      (action === "switch-camera" &&
        this.state === "live" &&
        this.#hasMultipleCameras &&
        !this.#counting);
    if (!allowed) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SvPhotoCaptureActionDetail>("sv-photo-capture-action", {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }

  readonly #onSwitch = (event: Event): void => {
    event.stopPropagation();
    this.#act("switch-camera");
  };

  /** Return the live frame as a JPEG, its dimensions, and the visible crop. Requires live state. */
  async capture(): Promise<SvCameraCapture> {
    await this.updateComplete;
    const camera = this.renderRoot.querySelector("sv-camera");
    if (this.state !== "live" || !camera) {
      throw new Error("sv-photo-capture-screen: capture requires a live camera");
    }
    await camera.updateComplete;
    return await camera.capture();
  }

  #guidance(copy: PhotoCaptureMessages, mobile = false) {
    const message = html`<sv-message class="guidance" variant="neutral" layout="card" silent>
      ${copy.guidance}
    </sv-message>`;
    return mobile
      ? html`<sv-glass class="mobile-guidance" variant="subtle">${message}</sv-glass>`
      : html`<div class="desktop-guidance">${message}</div>`;
  }

  #stage(copy: PhotoCaptureMessages) {
    if (this.state === "live" || this.state === "uploading") {
      return html`<div class="frame">
        ${
          this.state === "uploading"
            ? html`<sv-image
                .src=${this.photoSrc}
                .loadKey=${this.photoLoadKey}
                .alt=${this.ui.text("photo.reviewAlt")}
                .crop=${this.photoCrop}
                .framing=${photoImageFraming(this.photoFraming)}
              ></sv-image>`
            : html`<sv-camera
                .stream=${this.stream}
                .mirrored=${true}
                .countdownSeconds=${this.countdownSeconds}
                .countdownLabel=${copy.countdown}
                .switchLabel=${this.#hasMultipleCameras && !this.busy ? copy.switchCamera : undefined}
                @sv-switch-camera=${this.#onSwitch}
                @sv-camera-preview-state=${(
                  event: HTMLElementEventMap["sv-camera-preview-state"],
                ) => {
                  if (this.canStartTimer === undefined && event.detail.stream === this.stream) {
                    this.#previewStream =
                      event.detail.state === "ready" ? event.detail.stream : undefined;
                    this.requestUpdate();
                  }
                }}
              ></sv-camera>`
        }
        ${this.#guidance(copy, true)}
      </div>`;
    }
    const permission = this.state === "permission";
    let body = copy.error;
    if (this.state === "denied") {
      body = copy.deniedBody;
    }
    if (this.state === "unavailable") {
      body = copy.unavailable;
    }
    body = this.error ?? body;
    const error = body === "" ? nothing : html`<sv-message>${body}</sv-message>`;
    return html`<div class=${`frame ${permission ? "" : "failure"}`}>
      <div class="placeholder">
        ${permission ? html`<sv-icon name="camera"></sv-icon>` : nothing}
        ${this.state === "denied" ? html`<h3>${copy.deniedTitle}</h3>` : nothing}
        ${permission ? html`<p>${this.statusMessage ?? copy.permission}</p>` : error}
      </div>
    </div>`;
  }

  #primary(copy: PhotoCaptureMessages, busy: boolean) {
    const action = this.#primaryAction;
    const label = {
      "request-permission": copy.allowCamera,
      "start-timer": copy.startTimer,
      "cancel-timer": copy.cancelTimer,
      retry: copy.retry,
    }[action];
    return html`<sv-button
      slot="primary"
      .busy=${busy}
      .disabled=${busy || (action === "start-timer" && !this.#timerReady)}
      @click=${() => {
        this.#act(action);
      }}
      >${label}</sv-button
    >`;
  }

  protected override render() {
    const copy = photoCaptureMessages(
      this.ui,
      this.selfTimerDurationSeconds,
      this.countdownSeconds,
    );
    const busy = this.busy || this.state === "uploading";
    const locked = busy || this.#counting;
    const showsGuidance = this.state === "live" || this.state === "uploading";
    return html`<sv-screen
      .navigation=${this.navigation}
      lang=${this.ui.snapshot.resolvedLocale ?? this.ui.snapshot.locale}
      .heading=${copy.title}
      .description=${copy.subtitle}
      .busy=${locked}
      .statusMessage=${this.statusMessage ?? (busy ? copy.processing : "")}
      panel-align="center"
    >
      <div class="stage" slot="stage">${this.#stage(copy)}</div>
      ${showsGuidance ? this.#guidance(copy) : nothing}
      <div slot="before-actions"><slot name="recovery"></slot></div>
      ${this.state === "permission" && busy ? nothing : this.#primary(copy, busy)}
      <sv-button
        slot="secondary"
        variant="ghost"
        .disabled=${this.canChoosePhoto === false || (this.canChoosePhoto !== true && (busy || (this.#counting && this.navigation === undefined)))}
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
    "sv-photo-capture-screen": SvPhotoCaptureScreen;
  }
  interface HTMLElementEventMap {
    "sv-photo-capture-action": CustomEvent<SvPhotoCaptureActionDetail>;
  }
}
