import type { PropertyValues } from "lit";

import { css, html, nothing } from "lit";

import type { SvImageCrop } from "../../media/image-crop.js";

import { SvElement } from "../../internal/ui-element.js";
import { svBase } from "../../styles/base.js";
import { svTokens } from "../../styles/tokens.js";

export interface SvCameraProps {
  /** The live camera stream. Unset or null shows the empty black frame. */
  stream?: MediaStream | null | undefined;
  /** Shows the picture mirrored, as a selfie; the captured photo is mirrored the same way. */
  mirrored?: boolean | undefined;
  /** Seconds left on the self-timer, shown big over the picture; unset or 0 shows nothing. */
  countdownSeconds?: number | undefined;
  /** Announced with each countdown step, e.g. "Photo in 3 seconds". */
  countdownLabel?: string | undefined;
  /**
   * Shows a switch-camera button with this accessible name, e.g. "Switch camera"; unset hides
   * it. Hidden while the countdown runs.
   */
  switchLabel?: string | undefined;
}

export interface SvCameraCapture {
  /** The full camera frame as a JPEG, mirrored when the picture was. */
  blob: Blob;
  width: number;
  height: number;
  /** What the frame showed of it: the frame cuts the camera's picture to its own shape. */
  crop: SvImageCrop;
}

interface CameraPreviewState {
  stream: MediaStream;
  state: "ready" | "waiting" | "failed";
}

/** Sharp enough on high-density screens, without drawing 3× the pixels on phones that have them. */
const MAX_PIXEL_RATIO = 2;
const JPEG_QUALITY = 0.92;
/** Some embedded browsers expose video frame callbacks but stall on the hidden video. */
const FRAME_CALLBACK_TIMEOUT_MS = 500;
const PREVIEW_TIMEOUT_MS = 8_000;

/**
 * `<sv-camera>` — the live camera picture, for taking the shopper's photo.
 *
 * Shows `stream` filling its box, cut to the box's shape, in a rounded black frame. It never
 * opens the camera itself: the owner gets the stream (asking for permission) and hands it in.
 * `capture()` takes the photo: the full camera frame as a JPEG, and the part of it the frame
 * showed. With `countdownSeconds` it shows the seconds left big over the picture; with `switchLabel`
 * a button that fires `sv-switch-camera`. Anything slotted lies over the picture, e.g. a hint.
 *
 * The picture is redrawn onto a canvas rather than shown in a `<video>`, because in-app browsers
 * (Instagram's, Facebook's) open any playing video full screen with their own controls.
 *
 * @slot - Content over the picture, e.g. a hint at the bottom.
 * @fires sv-switch-camera - The switch-camera button was pressed.
 * @fires sv-camera-preview-state - The current stream produced a frame, stalled, or failed.
 * @csspart frame - The black frame.
 * @csspart countdown - The countdown's number.
 * @csspart switch - The switch-camera button.
 */
export class SvCamera extends SvElement implements SvCameraProps {
  #previewState: CameraPreviewState["state"] | undefined;
  #previewTimeout: ReturnType<typeof setTimeout> | undefined;
  protected override readonly usesMessages = true;
  static override styles = [
    svTokens,
    svBase,
    css`
      :host {
        display: block;
        min-inline-size: 0;
        min-block-size: 0;
      }
      .frame {
        position: relative;
        inline-size: 100%;
        block-size: 100%;
        overflow: hidden;
        border-radius: var(--_sv-radius-xl);
        background: var(--_sv-media-background);
        color: var(--_sv-media-foreground);
      }
      canvas {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
      }
      video {
        display: none;
      }
      .countdown {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .countdown span {
        display: grid;
        place-items: center;
        inline-size: calc(var(--_sv-spacing) * 28);
        block-size: calc(var(--_sv-spacing) * 28);
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-media-overlay);
        /* 48px, the ladder's step above 4xl. */
        font-size: calc(var(--_sv-text-4xl) * 4 / 3);
        line-height: 1;
        font-weight: var(--_sv-font-weight-medium);
        font-variant-numeric: tabular-nums;
      }
      .switch {
        appearance: none;
        position: absolute;
        inset-block-start: calc(var(--_sv-spacing) * 3);
        inset-inline-end: calc(var(--_sv-spacing) * 3);
        display: grid;
        place-items: center;
        inline-size: calc(var(--_sv-spacing) * 9);
        block-size: calc(var(--_sv-spacing) * 9);
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: var(--_sv-radius-full);
        background: var(--_sv-media-overlay);
        color: var(--_sv-media-foreground);
        cursor: pointer;
        backdrop-filter: blur(4px);
        --_sv-icon-size: calc(var(--_sv-spacing) * 5);
      }
      .switch:hover {
        background: var(--_sv-media-overlay-hover);
      }
      .switch:focus-visible {
        outline: 2px solid var(--_sv-media-foreground);
        outline-offset: 2px;
      }
      /* The owner places slotted content in this grid, e.g. \`align-self: end\` for a hint. */
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
      }
      .sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    `,
  ];

  static override properties = {
    stream: { attribute: false },
    mirrored: { type: Boolean, reflect: true },
    countdownSeconds: { type: Number, attribute: "countdown-seconds" },
    countdownLabel: { attribute: "countdown-label" },
    switchLabel: { attribute: "switch-label" },
  };

  declare stream: MediaStream | null | undefined;
  declare mirrored: boolean;
  declare countdownSeconds: number | undefined;
  declare countdownLabel: string | undefined;
  declare switchLabel: string | undefined;

  #stopDrawing: (() => void) | undefined;
  #resize: ResizeObserver | undefined;

  constructor() {
    super();
    this.stream = undefined;
    this.mirrored = false;
    this.countdownSeconds = undefined;
    this.countdownLabel = undefined;
    this.switchLabel = undefined;
  }

  get #video(): HTMLVideoElement | null {
    return this.renderRoot.querySelector("video");
  }

  get #canvas(): HTMLCanvasElement | null {
    return this.renderRoot.querySelector("canvas");
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) {
      this.#observeCanvas();
      this.#start();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
    this.#resize?.disconnect();
    this.#resize = undefined;
  }

  protected override firstUpdated(): void {
    const video = this.#video;
    if (video) {
      // Set as properties too: some webviews only honor these as properties, others only as
      // attributes, before they agree to play inline and without sound.
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.addEventListener("loadeddata", this.#onReady);
      video.addEventListener("canplay", this.#onReady);
      video.addEventListener("playing", this.#onReady);
      video.addEventListener("waiting", this.#onWaiting);
      video.addEventListener("emptied", this.#onWaiting);
      video.addEventListener("error", () => {
        if (this.stream) {
          this.#reportPreview(this.stream, "failed");
        }
      });
    }
    this.#observeCanvas();
  }

  #observeCanvas(): void {
    const frame = this.renderRoot.querySelector(".frame");
    if (frame && typeof ResizeObserver !== "undefined") {
      this.#resize = new ResizeObserver(() => {
        this.#sizeCanvas();
      });
      this.#resize.observe(frame);
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("stream")) {
      this.#stop();
      this.#previewState = undefined;
      const video = this.#video;
      if (video) {
        video.srcObject = this.stream ?? null;
      }
      if (this.stream) {
        this.#start();
      } else {
        this.#clear();
      }
    } else if (changed.has("mirrored") && this.stream) {
      this.#draw();
    }
  }

  readonly #onReady = (): void => {
    if (this.stream) {
      this.#draw();
    }
    this.#start();
  };

  readonly #onWaiting = (): void => {
    if (this.stream && this.#previewState === "ready") {
      this.#reportPreview(this.stream, "waiting");
      this.#watchPreview(this.stream);
    }
  };

  #watchPreview(stream: MediaStream): void {
    clearTimeout(this.#previewTimeout);
    this.#previewTimeout = setTimeout(() => {
      this.#reportPreview(stream, "failed");
    }, PREVIEW_TIMEOUT_MS);
  }

  /** Plays the hidden video and draws each new frame. Safe to call repeatedly. */
  #start(): void {
    const video = this.#video;
    const { stream } = this;
    if (!this.isConnected || !video || !stream || this.#stopDrawing) {
      return;
    }
    this.#sizeCanvas();
    if (this.#previewState === undefined || this.#previewState === "waiting") {
      this.#watchPreview(stream);
    }
    void this.#play(video, stream);

    const supportsVideoFrames =
      typeof video.requestVideoFrameCallback === "function" &&
      typeof video.cancelVideoFrameCallback === "function";
    const requestPaint = (draw: FrameRequestCallback): number => requestAnimationFrame(draw);
    const cancelPaint = (frame: number): void => {
      cancelAnimationFrame(frame);
    };
    let requestFrame = supportsVideoFrames
      ? video.requestVideoFrameCallback.bind(video)
      : requestPaint;
    let cancelFrame = supportsVideoFrames
      ? video.cancelVideoFrameCallback.bind(video)
      : cancelPaint;
    let lastFrame = performance.now();
    const draw = (now: number): void => {
      lastFrame = now;
      this.#draw();
      frame = requestFrame(draw);
    };
    let frame = requestFrame(draw);
    const watchdog: ReturnType<typeof setInterval> | undefined = supportsVideoFrames
      ? setInterval(() => {
          if (
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            performance.now() - lastFrame >= FRAME_CALLBACK_TIMEOUT_MS
          ) {
            // Keep the preview live when a ready video stops delivering callbacks.
            clearInterval(watchdog);
            cancelFrame(frame);
            requestFrame = requestPaint;
            cancelFrame = cancelPaint;
            frame = requestFrame(draw);
          }
        }, FRAME_CALLBACK_TIMEOUT_MS)
      : undefined;
    this.#stopDrawing = () => {
      clearInterval(watchdog);
      cancelFrame(frame);
    };
  }

  /** A blocked autoplay still leaves frames to draw once the stream starts. */
  async #play(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
    try {
      await video.play();
    } catch {
      if (this.stream === stream && this.isConnected && this.#previewState === undefined) {
        this.#draw();
        if (this.#previewState === undefined) {
          this.#reportPreview(stream, "failed");
        }
      }
    }
  }

  #reportPreview(stream: MediaStream, state: CameraPreviewState["state"]): void {
    if (this.stream !== stream || !this.isConnected || this.#previewState === state) {
      return;
    }
    this.#previewState = state;
    clearTimeout(this.#previewTimeout);
    this.dispatchEvent(
      new CustomEvent<CameraPreviewState>("sv-camera-preview-state", {
        detail: { stream, state },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #stop(): void {
    clearTimeout(this.#previewTimeout);
    this.#stopDrawing?.();
    this.#stopDrawing = undefined;
  }

  #clear(): void {
    const canvas = this.#canvas;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  #sizeCanvas(): void {
    const canvas = this.#canvas;
    if (!canvas) {
      return;
    }
    const { width, height } = canvas.getBoundingClientRect();
    const ratio = Math.min(MAX_PIXEL_RATIO, globalThis.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      if (this.stream) {
        this.#draw();
      }
    }
  }

  /** The video drawn to cover the canvas, centered, mirrored when asked. */
  #draw(): void {
    const video = this.#video;
    const canvas = this.#canvas;
    if (!video || !canvas) {
      return;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.#onWaiting();
      return;
    }
    const { videoWidth: vw, videoHeight: vh } = video;
    const { width: cw, height: ch } = canvas;
    if (vw === 0 || vh === 0) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    context.save();
    if (this.mirrored) {
      context.translate(cw, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    context.restore();
    if (this.stream && this.#previewState !== "ready") {
      this.#reportPreview(this.stream, "ready");
    }
  }

  /**
   * Takes the photo: the camera's full frame as a JPEG (mirrored when the picture is), and the
   * part of it the frame showed. Rejects while there is no picture yet.
   */
  async capture(): Promise<SvCameraCapture> {
    const video = this.#video;
    const { videoWidth: width, videoHeight: height } = video ?? { videoWidth: 0, videoHeight: 0 };
    if (
      !video ||
      this.#previewState === "waiting" ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      width === 0 ||
      height === 0
    ) {
      throw new Error("sv-camera: no picture to capture yet");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("sv-camera: no 2D canvas");
    }
    if (this.mirrored) {
      context.scale(-1, 1);
      context.drawImage(video, -width, 0, width, height);
    } else {
      context.drawImage(video, 0, 0, width, height);
    }
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    const blob = await promise;
    if (!blob) {
      throw new Error("sv-camera: the photo could not be encoded");
    }
    return { blob, width, height, crop: this.#visibleCrop(width, height) };
  }

  /** The centered part of a `width` × `height` picture that covering the frame leaves visible. */
  #visibleCrop(width: number, height: number): SvImageCrop {
    const frame = this.renderRoot.querySelector(".frame")?.getBoundingClientRect();
    if (!frame || frame.width === 0 || frame.height === 0) {
      return { cx: 0.5, cy: 0.5, width: 1, height: 1 };
    }
    const picture = width / height;
    const shown = frame.width / frame.height;
    return picture > shown
      ? { cx: 0.5, cy: 0.5, width: shown / picture, height: 1 }
      : { cx: 0.5, cy: 0.5, width: 1, height: picture / shown };
  }

  readonly #onSwitch = (): void => {
    this.dispatchEvent(new CustomEvent("sv-switch-camera", { bubbles: true, composed: true }));
  };

  protected override render() {
    const counting = this.countdownSeconds !== undefined && this.countdownSeconds > 0;
    return html`<div part="frame" class="frame">
      <canvas role="img" aria-label=${this.ui.text("photo.cameraPreview")}></canvas>
      <video
        autoplay
        muted
        playsinline
        disablepictureinpicture
        disableremoteplayback
        controlslist="nodownload nofullscreen noremoteplayback noplaybackrate"
        aria-hidden="true"
      ></video>
      <div class="overlay"><slot></slot></div>
      ${
        counting
          ? html`<div class="countdown" role="status">
              <span part="countdown" aria-hidden="true">${this.countdownSeconds}</span>
              <span class="sr">${this.countdownLabel ?? nothing}</span>
            </div>`
          : nothing
      }
      ${
        this.switchLabel !== undefined && this.switchLabel !== "" && !counting
          ? html`<button
              part="switch"
              class="switch"
              type="button"
              aria-label=${this.switchLabel}
              @click=${this.#onSwitch}
            >
              <sv-icon name="switch-camera"></sv-icon>
            </button>`
          : nothing
      }
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-camera": SvCamera;
  }
  interface HTMLElementEventMap {
    "sv-switch-camera": CustomEvent<undefined>;
    "sv-camera-preview-state": CustomEvent<CameraPreviewState>;
  }
}
