import type {
  FlowView,
  ImageView,
  InteractionToken,
  MediaId,
  MessageId,
  TryOnId,
  VariantId,
} from "@studio-vaai/core";
import type { TemplateResult } from "lit";

import {
  BackendError,
  CameraAction,
  CameraEvent,
  CameraPreview,
  CameraState,
  DeviceEvent,
  DeviceError,
  FlowAction,
  HeightAction,
  BodyState,
  bodyHeight,
  HeightStatus,
  Issue,
  ImagePhase,
  ImageTarget,
  RenderMediaAction,
  RenderMediaOutcome,
  classifyDownloadFailure,
  Modal,
  NavigationAction,
  PhotoAction,
  PhotoRejection,
  PhotoSource,
  PhotoUploadPhase,
  TryOnProgress,
  PresenceAction,
  PresentationAction,
  ScreenView,
  SelectionAction,
  SessionAction,
  SessionPhase,
  SizeRecommendationAction,
} from "@studio-vaai/core";
import { css, html, nothing } from "lit";

import type { SvVariantCommerce } from "../commerce/types.js";
import type { SvScreenNavigation } from "../components/screen/sv-screen.js";
import type { SvImageFraming } from "../media/image-framing.js";
import type { SvPhotoCaptureScreen } from "../screens/sv-photo-capture-screen.js";
import type { SvTryOnFit } from "../screens/try-on-view/fit.js";
import type { TryOnExperience, TryOnRenderer } from "./controller.js";
import type { TryOnExperienceEvent, TryOnExperienceEventMap } from "./events.js";

import { SvImage } from "../components/image/sv-image.js";
import { SvElement } from "../internal/ui-element.js";
import { fitForResult } from "./api/fit.js";
import { ImageFetchError } from "./image-fetch-error.js";
import {
  displayedTryOnId,
  heightPending,
  tryOnResults,
  tryOnScreenState,
  uncertainBodyMessage,
} from "./presentation.js";

type ImageStateEvent = HTMLElementEventMap["sv-image-state"];
interface ImageAsset {
  id: InteractionToken;
  src: string;
}

function imageLoadKey(image: ImageView | undefined): string | undefined {
  return image?.load;
}

const PHOTO_REJECTION_MESSAGES = {
  [PhotoRejection.NoHumanDetected]: "bodyFailure.noHumanDetected",
  [PhotoRejection.HumanOccluded]: "bodyFailure.humanOccluded",
  [PhotoRejection.HumanNotStanding]: "bodyFailure.humanNotStanding",
  [PhotoRejection.HumanTooSmall]: "bodyFailure.humanTooSmall",
  [PhotoRejection.InappropriateClothing]: "bodyFailure.inappropriateClothing",
} as const;

export interface SvTryOnExperienceProps {
  /** Controller created with the Rust flow configuration and host adapters. */
  experience?: TryOnExperience | undefined;
  /** Display name for the product shown in variant selection and results. */
  productName?: string | undefined;
  /** Override the experience’s formatted prices by variant ID. */
  prices?: Readonly<Record<VariantId, string>> | undefined;
  /** Framing applied to the generated result image. */
  resultFraming?: SvImageFraming | undefined;
  /** Adds the requested variant to the host cart. The dialog closes after this succeeds. */
  addToCart?:
    | ((detail: TryOnExperienceEventMap["sv-try-on-add-to-cart-requested"]) => void | Promise<void>)
    | undefined;
}

/**
 * Renders the default Rust flow in a dialog using the supplied controller.
 * @fires {CustomEvent<unknown>} sv-try-on-experience-error - An action or adapter failed to run. The detail is the underlying error.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-opened"]>} sv-try-on-opened - The experience opened.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-closed"]>} sv-try-on-closed - The experience closed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-step-changed"]>} sv-try-on-step-changed - The visible journey step changed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-consent-granted"]>} sv-try-on-consent-granted - A new consented session was established.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-session-failed"]>} sv-try-on-session-failed - The session could not be restored or created.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-photo-source-started"]>} sv-try-on-photo-source-started - The shopper opened the picker or camera.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-photo-source-cancelled"]>} sv-try-on-photo-source-cancelled - The shopper left a photo source without a photo.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-photo-processing"]>} sv-try-on-photo-processing - Photo processing started.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-photo-accepted"]>} sv-try-on-photo-accepted - The API accepted the photo.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-photo-rejected"]>} sv-try-on-photo-rejected - The API rejected the photo.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-photo-failed"]>} sv-try-on-photo-failed - Photo processing failed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-height-confirmed"]>} sv-try-on-height-confirmed - The API acknowledged the height update.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-height-failed"]>} sv-try-on-height-failed - Saving the height failed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-picker-failed"]>} sv-try-on-picker-failed - The photo picker failed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-camera-failed"]>} sv-try-on-camera-failed - Camera access or the live stream failed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-capture-failed"]>} sv-try-on-capture-failed - The camera could not capture a frame.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-operation-uncertain"]>} sv-try-on-operation-uncertain - The outcome of an outstanding operation could not be confirmed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-variant-changed"]>} sv-try-on-variant-changed - The draft selection changed or became available.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-requested"]>} sv-try-on-requested - The flow admitted a try-on request.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-request-resolved"]>} sv-try-on-request-resolved - A result fulfilled the request.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-rendered"]>} sv-try-on-rendered - The API produced a new result.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-presented"]>} sv-try-on-presented - The flow displayed a result.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-refused"]>} sv-try-on-refused - A try-on request was refused.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-failed"]>} sv-try-on-failed - A try-on request failed.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-detached"]>} sv-try-on-detached - The shopper let go of a try-on request before it was shown.
 * @fires {CustomEvent<TryOnExperienceEventMap["sv-try-on-add-to-cart-requested"]>} sv-try-on-add-to-cart-requested - The shopper asked the storefront to add a variant.
 */
export class SvTryOnExperience extends SvElement implements SvTryOnExperienceProps {
  protected override readonly usesMessages = true;
  static override styles = css`
    :host {
      display: contents;
    }
    .recovery {
      display: grid;
      gap: 0.375rem;
    }
    .recovery p,
    .picker-note p {
      margin: 0;
    }

    .confirmation {
      display: grid;
      gap: 1rem;
      padding: 1.25rem;
    }
    .confirmation p {
      margin: 0;
    }
    [data-photo-source] .confirmation {
      align-content: start;
    }
  `;
  static override properties = {
    experience: { attribute: false, noAccessor: true },
    productName: { attribute: "product-name" },
    prices: { attribute: false },
    resultFraming: { attribute: false },
    addToCart: { attribute: false, noAccessor: true },
  };

  #experience: TryOnExperience | undefined;

  get experience(): TryOnExperience | undefined {
    return this.#experience;
  }

  set experience(value: TryOnExperience | undefined) {
    const previous = this.#experience;
    if (previous === value) {
      return;
    }
    this.#experience = value;
    if (this.isConnected) {
      this.#bind();
    }
    this.requestUpdate("experience", previous);
  }
  declare productName: string | undefined;

  declare resultFraming: SvImageFraming | undefined;

  declare prices: SvTryOnExperienceProps["prices"];
  #addToCart: SvTryOnExperienceProps["addToCart"];

  get addToCart(): SvTryOnExperienceProps["addToCart"] {
    return this.#addToCart;
  }

  set addToCart(handler: SvTryOnExperienceProps["addToCart"]) {
    const previous = this.#addToCart;
    this.#addToCart = handler;
    if ((previous === undefined) !== (handler === undefined)) {
      this.#renderer?.setCartAvailable(handler !== undefined);
    }
  }

  #unsubscribe: (() => void) | undefined;
  #unsubscribeEvents: (() => void) | undefined;
  #renderer: TryOnRenderer | undefined;
  #bound: TryOnExperience | undefined;
  #dialogContent: TemplateResult | undefined;
  #view: FlowView | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #photoFactsOpen = false;
  #withdrawalOpen = false;
  #fitDetailsOpen = false;
  #activeCalloutKey: string | undefined;
  readonly #imageAssets = new Map<InteractionToken, ImageAsset>();
  readonly #observedImages = new Map<string, ImageAsset>();
  #reportedFailure: unknown;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#bind();
    this.ownerDocument.addEventListener("visibilitychange", this.#visibilityChanged);
  }

  override disconnectedCallback(): void {
    this.ownerDocument.removeEventListener("visibilitychange", this.#visibilityChanged);
    this.#unsubscribe?.();
    this.#unsubscribeEvents?.();
    this.#renderer?.detach();
    this.#renderer = undefined;
    this.#bound = undefined;
    clearInterval(this.#timer);
    this.#timer = undefined;
    super.disconnectedCallback();
  }

  #bind(): void {
    if (!this.isConnected || this.#bound === this.experience) {
      return;
    }
    this.#unsubscribe?.();
    this.#unsubscribeEvents?.();
    this.#renderer?.detach();
    this.#renderer = undefined;
    this.#bound = this.experience;
    this.#view = undefined;
    this.#dialogContent = undefined;
    this.#imageAssets.clear();
    this.#observedImages.clear();
    this.#reportedFailure = undefined;
    this.#renderer = this.experience?.attachRenderer(
      this.ownerDocument.visibilityState !== "hidden",
      this.addToCart !== undefined,
      {
        media: this.#runImageWork,
        capture: async (stream) => await this.captureCamera(stream),
        cart: () => this.addToCart,
        resourcesChanged: () => {
          this.#observeImages(this.#view);
        },
      },
    );
    this.#unsubscribe = this.experience?.subscribe(this.#readView);
    this.#unsubscribeEvents = this.experience?.subscribeEvents(this.#emitEvent);
    this.#readView();
  }

  readonly #visibilityChanged = (): void => {
    const foreground = this.ownerDocument.visibilityState !== "hidden";
    if (this.#view?.presence.foreground === foreground) {
      return;
    }
    try {
      this.#renderer?.setForeground(foreground);
    } catch (error) {
      this.#reportError(error);
    }
  };

  readonly #emitEvent = (event: TryOnExperienceEvent): void => {
    if (this.#renderer?.token !== this.#bound?.view.renderer) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent(event.type, { detail: event.detail, bubbles: true, composed: true }),
    );
  };

  readonly #readView = (): void => {
    const previous = this.#view;
    const next = this.#bound?.view;
    const view =
      this.#renderer !== undefined && next?.renderer === this.#renderer.token ? next : undefined;
    this.#view = view;
    const screen = view?.screen;
    const oldScreen = previous?.screen;
    if (screen?.tag !== oldScreen?.tag || view?.presence.open !== previous?.presence.open) {
      this.#photoFactsOpen = false;
      this.#withdrawalOpen = false;
      this.#fitDetailsOpen = false;
      this.#activeCalloutKey = undefined;
    }
    if (
      view !== undefined &&
      previous !== undefined &&
      screen !== undefined &&
      oldScreen !== undefined &&
      ScreenView.TryOn.instanceOf(screen) &&
      ScreenView.TryOn.instanceOf(oldScreen)
    ) {
      const current = displayedTryOnId(screen.inner.presentation);
      const old = displayedTryOnId(oldScreen.inner.presentation);
      if (old !== current) {
        this.#fitDetailsOpen = false;
        this.#activeCalloutKey = undefined;
      }
    }
    const countdown =
      view?.presence.open === true &&
      screen !== undefined &&
      ScreenView.Camera.instanceOf(screen) &&
      CameraState.Countdown.instanceOf(screen.inner.camera);
    if (countdown && this.#timer === undefined) {
      this.#timer = setInterval(() => {
        this.requestUpdate();
      }, 150);
    } else if (!countdown) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    const failure = view === undefined ? undefined : this.experience?.failure;
    if (failure !== undefined && this.#reportedFailure !== failure) {
      this.#reportedFailure = failure;
      this.#reportError(failure);
    }
    this.#observeImages(view);
    this.requestUpdate();
  };

  #reportError(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent("sv-try-on-experience-error", {
        detail: error,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #dispatch(action: FlowAction): void {
    try {
      this.#renderer?.dispatch(action, true);
    } catch (error) {
      this.#reportError(error);
    }
  }

  readonly #back = (): void => {
    this.#dispatch(new FlowAction.Navigation({ action: NavigationAction.Back }));
  };

  readonly #close = (): void => {
    this.#dispatch(new FlowAction.Presence({ action: PresenceAction.Close }));
  };

  #beginPhoto(source: PhotoSource): void {
    this.#dispatch(new FlowAction.Photo({ action: new PhotoAction.BeginSource({ source }) }));
  }

  readonly #introChange = ({ detail }: HTMLElementEventMap["sv-session-intro-change"]): void => {
    switch (detail.field) {
      case "consented": {
        this.#dispatch(
          new FlowAction.Session({
            action: new SessionAction.SetConsent({ accepted: detail.value }),
          }),
        );
        break;
      }
      case "photoFactsOpen": {
        this.#photoFactsOpen = detail.value;
        break;
      }
      case "withdrawalOpen": {
        this.#withdrawalOpen = detail.value;
        break;
      }
      default: {
        break;
      }
    }
    this.requestUpdate();
  };

  readonly #introAction = ({ detail }: HTMLElementEventMap["sv-session-intro-action"]): void => {
    if (detail.action !== "consent-required") {
      this.#beginPhoto(detail.action === "camera" ? PhotoSource.Camera : PhotoSource.Library);
    }
  };

  readonly #cameraAction = ({ detail }: HTMLElementEventMap["sv-photo-capture-action"]): void => {
    switch (detail.action) {
      case "upload": {
        this.#beginPhoto(PhotoSource.Library);
        return;
      }
      case "request-permission":
      case "retry": {
        this.#dispatch(new FlowAction.Camera({ action: new CameraAction.Retry() }));
        return;
      }
      case "start-timer": {
        this.#dispatch(
          new FlowAction.Camera({
            action: new CameraAction.StartSelfTimer({ now: BigInt(Math.floor(performance.now())) }),
          }),
        );
        return;
      }
      case "cancel-timer": {
        this.#dispatch(new FlowAction.Camera({ action: new CameraAction.CancelSelfTimer() }));
        return;
      }
      case "switch-camera": {
        this.#dispatch(new FlowAction.Camera({ action: new CameraAction.Switch() }));
        break;
      }
      default: {
        break;
      }
    }
  };

  #replacePhoto(): void {
    if (this.#experience?.view.domain.photo?.source === PhotoSource.Library) {
      this.#beginPhoto(PhotoSource.Library);
    } else {
      this.#dispatch(new FlowAction.Photo({ action: new PhotoAction.Replace() }));
    }
  }

  readonly #heightChange = ({ detail }: HTMLElementEventMap["sv-height-setting-change"]): void => {
    this.#dispatch(
      new FlowAction.Height({ action: new HeightAction.Edit({ height: detail.value }) }),
    );
  };

  readonly #heightAction = ({ detail }: HTMLElementEventMap["sv-height-setting-action"]): void => {
    if (detail.action === "confirm") {
      this.#dispatch(new FlowAction.Height({ action: new HeightAction.Confirm() }));
    } else {
      this.#replacePhoto();
    }
  };

  readonly #rejectedAction = ({
    detail,
  }: HTMLElementEventMap["sv-photo-upload-rejected-action"]): void => {
    if (detail.action === "guide") {
      this.#dispatch(new FlowAction.Photo({ action: new PhotoAction.ShowGuide() }));
      return;
    }
    const screen = this.#experience?.view.screen;
    if (screen !== undefined && ScreenView.PhotoRejected.instanceOf(screen)) {
      this.#beginPhoto(screen.inner.photo.source);
    }
  };

  readonly #tryOnChange = ({ detail }: HTMLElementEventMap["sv-try-on-view-change"]): void => {
    switch (detail.field) {
      case "stockNotice": {
        break;
      }
      case "selection": {
        this.#dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.SelectItem({ axis: detail.axis, item: detail.item }),
          }),
        );
        break;
      }
      case "displayedImage": {
        this.#dispatch(
          new FlowAction.Presentation({
            action: new PresentationAction.ShowTryOn({ tryOnId: detail.tryOnId }),
          }),
        );
        break;
      }
      case "displayedAxis": {
        this.#dispatch(
          new FlowAction.Presentation({
            action: new PresentationAction.ShowAxisItem({ axis: detail.axis, item: detail.item }),
          }),
        );
        break;
      }
      case "pickerOpen": {
        this.#dispatch(
          new FlowAction.Presentation({
            action: new PresentationAction.SetVariantPicker({ open: detail.value }),
          }),
        );
        break;
      }
      case "fitDetailsOpen": {
        this.#fitDetailsOpen = detail.value;
        break;
      }
      case "activeCalloutKey": {
        this.#activeCalloutKey = detail.value;
        break;
      }
      default: {
        break;
      }
    }
    this.requestUpdate();
  };

  readonly #tryOnAction = ({ detail }: HTMLElementEventMap["sv-try-on-view-action"]): void => {
    switch (detail.action) {
      case "try-on":
      case "retry": {
        this.#dispatch(
          new FlowAction.Presentation({
            action: new PresentationAction.RunPrimary({ variantId: detail.variantId }),
          }),
        );
        break;
      }
      case "select-recommendation": {
        this.#dispatch(
          new FlowAction.SizeRecommendation({ action: SizeRecommendationAction.Select }),
        );
        break;
      }
      case "upload": {
        this.#replacePhoto();
        break;
      }
      case "add-to-cart": {
        this.#dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.RequestResultCart({
              tryOnId: detail.tryOnId,
              variantId: detail.variantId,
            }),
          }),
        );
        break;
      }
      case "download": {
        this.#dispatch(
          new FlowAction.RenderMedia({
            action: new RenderMediaAction.Download({ tryOnId: detail.tryOnId }),
          }),
        );
        break;
      }
      case "retry-fit-score": {
        this.#dispatch(
          new FlowAction.Presentation({
            action: new PresentationAction.RetryResultFit({ tryOnId: detail.tryOnId }),
          }),
        );
        break;
      }
      // no default
    }
  };

  readonly #runImageWork = async (
    kind: "recover" | "renew-download" | "download",
    image: ImageView,
    signal: AbortSignal,
  ): Promise<RenderMediaOutcome> => {
    const experience = this.#bound;
    const asset = this.#asset(image);
    if (experience === undefined || asset === undefined) {
      throw new Error("The image is no longer current.");
    }
    const { target } = image;
    if (kind === "recover") {
      try {
        await (ImageTarget.Source.instanceOf(target)
          ? experience.adapters.refreshPhoto?.(target.inner.media, asset.src, signal)
          : experience.adapters.refreshResult?.(target.inner.tryOnId, signal, asset.src));
      } catch {
        // The current URL may still work when retried.
      }
      signal.throwIfAborted();
      this.#observeImages(this.#view);
      return RenderMediaOutcome.Succeeded;
    }

    if (!ImageTarget.Result.instanceOf(target)) {
      throw new Error("Only try-on results can be downloaded.");
    }
    if (kind === "renew-download") {
      await experience.adapters.refreshResult?.(target.inner.tryOnId, signal, asset.src);
      signal.throwIfAborted();
      this.#observeImages(this.#view);
      return RenderMediaOutcome.Succeeded;
    }
    let blob: Blob;
    try {
      blob = await (experience.adapters.fetchImage?.(asset.src, signal) ??
        this.#fetchImage(asset.src, signal));
    } catch (error) {
      signal.throwIfAborted();
      return classifyDownloadFailure(
        error instanceof ImageFetchError ? error.status : undefined,
        experience.adapters.refreshResult !== undefined,
      );
    }
    signal.throwIfAborted();
    const href = URL.createObjectURL(blob);
    const link = this.ownerDocument.createElement("a");
    link.href = href;
    const extension = new Map([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ]).get(blob.type);
    link.download = extension === undefined ? "try-on" : `try-on.${extension}`;
    try {
      this.ownerDocument.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(href);
      }, 1000);
    }
    return RenderMediaOutcome.Succeeded;
  };

  async #fetchImage(src: string, signal: AbortSignal) {
    const response = await fetch(src, { signal, credentials: "omit" });
    if (!response.ok) {
      throw new ImageFetchError(response.status);
    }
    return await response.blob();
  }

  #asset(image: ImageView | undefined): ImageAsset | undefined {
    return image?.asset === undefined ? undefined : this.#imageAssets.get(image.asset);
  }

  #observeImages(view: FlowView | undefined): void {
    if (view === undefined) {
      return;
    }
    const { source, result } = view.renderMedia ?? {};
    const sourceKey =
      source !== undefined && ImageTarget.Source.instanceOf(source.target)
        ? `photo:${source.target.inner.media}`
        : undefined;
    const retained = new Set(view.domain.tryOns.map(({ id }) => `result:${id}`));
    if (view.domain.photo !== undefined) {
      retained.add(`photo:${view.domain.photo.media}`);
    }
    if (sourceKey !== undefined) {
      retained.add(sourceKey);
    }
    for (const key of this.#observedImages.keys()) {
      if (!retained.has(key)) {
        this.#observedImages.delete(key);
      }
    }
    if (source !== undefined && ImageTarget.Source.instanceOf(source.target)) {
      const { media } = source.target.inner;
      const photo = this.#bound?.adapters.getPhoto(media);
      this.#observeImage(source, `photo:${media}`, photo?.src, photo?.signed?.asset);
    }
    if (result !== undefined && ImageTarget.Result.instanceOf(result.target)) {
      const { tryOnId } = result.target.inner;
      // Custom adapters can supply the initial URL as part of the domain outcome.
      const src =
        this.#bound?.adapters.getResult?.(tryOnId)?.result.imageUrl ??
        view.domain.tryOns.find(({ id }) => id === tryOnId)?.imageUrl;
      this.#observeImage(result, `result:${tryOnId}`, src);
    }
    const active = new Set([
      this.#view?.renderMedia?.source?.asset,
      this.#view?.renderMedia?.result?.asset,
    ]);
    for (const { id } of this.#observedImages.values()) {
      active.add(id);
    }
    for (const id of this.#imageAssets.keys()) {
      if (!active.has(id)) {
        this.#imageAssets.delete(id);
      }
    }
  }

  #observeImage(
    image: ImageView,
    key: string,
    src: string | undefined,
    signedId?: InteractionToken,
  ): void {
    if (src === undefined || src === "") {
      return;
    }
    let asset = this.#observedImages.get(key);
    if (
      asset === undefined ||
      asset.src !== src ||
      (signedId !== undefined && signedId !== asset.id)
    ) {
      const shared = ImageTarget.Result.instanceOf(image.target)
        ? [...this.#observedImages].find(
            ([key, value]) => key.startsWith("result:") && value.src === src,
          )?.[1]
        : undefined;
      asset = shared ?? { id: signedId ?? crypto.randomUUID(), src };
      this.#observedImages.set(key, asset);
      this.#imageAssets.set(asset.id, asset);
    }
    if (asset.id !== image.asset) {
      this.#renderer?.dispatch(
        new FlowAction.RenderMedia({
          action: new RenderMediaAction.ImageAssetObserved({
            target: image.target,
            token: image.token,
            asset: asset.id,
          }),
        }),
      );
    }
  }

  #recordImage(event: ImageStateEvent, image: ImageView | undefined): void {
    const [element] = event.composedPath();
    if (!(element instanceof SvImage) || image?.version === undefined) {
      return;
    }
    if (
      this.#asset(image)?.src !== event.detail.src ||
      event.detail.loadKey !== imageLoadKey(image)
    ) {
      return;
    }
    this.#renderer?.dispatch(
      new FlowAction.RenderMedia({
        action: new RenderMediaAction.ImageDecoded({
          target: image.target,
          token: image.token,
          version: image.version,
          ready: event.detail.state === "ready",
        }),
      }),
    );
  }

  #recordSourceImage(event: ImageStateEvent, id: MediaId | undefined): void {
    const source = this.#view?.renderMedia?.source;
    if (
      source !== undefined &&
      ImageTarget.Source.instanceOf(source.target) &&
      source.target.inner.media === id
    ) {
      this.#recordImage(event, source);
    }
  }

  #sourceImageRecovery(id: MediaId | undefined) {
    const source = this.#view?.renderMedia?.source;
    return source !== undefined &&
      ImageTarget.Source.instanceOf(source.target) &&
      source.target.inner.media === id &&
      source.phase === ImagePhase.Failed
      ? this.#message("experience.photoImageFailed")
      : nothing;
  }

  #photo(id: string | undefined) {
    if (id === undefined) {
      return;
    }
    const photo = this.experience?.adapters.getPhoto(id);
    const source = this.#view?.renderMedia?.source;
    if (
      source === undefined ||
      !ImageTarget.Source.instanceOf(source.target) ||
      source.target.inner.media !== id
    ) {
      return photo === undefined ? undefined : { ...photo, loadKey: undefined };
    }
    return { ...photo, src: this.#asset(source)?.src, loadKey: imageLoadKey(source) };
  }

  /** Capture the same camera frame and crop the shopper sees. */
  async captureCamera(expectedStream?: MediaStream) {
    const screen = this.renderRoot.querySelector<SvPhotoCaptureScreen>("sv-photo-capture-screen");
    if (
      screen === null ||
      this.#view === undefined ||
      (expectedStream !== undefined && screen.stream !== expectedStream)
    ) {
      throw new Error("The try-on camera is no longer visible.");
    }
    return await screen.capture();
  }

  #fit(tryOnId: TryOnId, view: FlowView): SvTryOnFit | undefined {
    if (!ScreenView.TryOn.instanceOf(view.screen)) {
      return undefined;
    }
    const { fitRetryable } = view.screen.inner.presentation;
    const result = view.domain.tryOns.find(({ id }) => id === tryOnId);
    if (result !== undefined) {
      return fitForResult(result, fitRetryable, (message) => this.ui.text(message));
    }
    return undefined;
  }

  #navigation(view: FlowView): SvScreenNavigation {
    if (view.canGoBack) {
      return { back: "available", close: true };
    }
    return {
      back: ScreenView.Introduction.instanceOf(view.screen) ? "hidden" : "disabled",
      close: true,
    };
  }

  #button(label: MessageId, action: () => void, slot?: "primary" | "secondary", disabled = false) {
    return html`<sv-button
      slot=${slot ?? nothing}
      variant=${slot === "primary" ? "primary" : "ghost"}
      .disabled=${disabled}
      @click=${action}
      >${this.ui.text(label)}</sv-button
    >`;
  }

  #message(label: MessageId | undefined) {
    return label === undefined ? nothing : html`<sv-message>${this.ui.text(label)}</sv-message>`;
  }

  #recovery(view: FlowView, content = html``) {
    return html`<div class="recovery" slot="recovery">
      ${content}
      ${this.#message(
        view.issue !== undefined && Issue.Rejected.instanceOf(view.issue)
          ? "experience.actionFailed"
          : undefined,
      )}
    </div>`;
  }

  #renderStagedPhoto(view: FlowView, phase: PhotoUploadPhase) {
    const change = view.photoChange?.newPhoto;
    const staged = change?.photo;
    const photo = this.#photo(staged?.media);
    const busy = phase === PhotoUploadPhase.Pending;
    const canRetry = phase === PhotoUploadPhase.RetryableFailure;
    const choosePhoto = () => {
      this.#dispatch(new FlowAction.Photo({ action: new PhotoAction.Replace() }));
    };
    let error: MessageId | undefined;
    let primary;
    if (phase === PhotoUploadPhase.Uncertain) {
      error = "experience.photoUncertain";
      primary = this.#button("experience.choosePhoto", choosePhoto, "primary");
    } else if (phase === PhotoUploadPhase.InvalidPhoto || phase === PhotoUploadPhase.Failed) {
      error =
        phase === PhotoUploadPhase.InvalidPhoto
          ? "experience.photoInvalid"
          : "experience.photoFailed";
      primary = this.#button("experience.choosePhoto", choosePhoto, "primary");
    } else if (canRetry) {
      error = "experience.photoFailed";
      primary = this.#button(
        "experience.retryPhoto",
        () => {
          this.#dispatch(new FlowAction.Photo({ action: new PhotoAction.Retry() }));
        },
        "primary",
      );
    }
    const imageRecovery = this.#sourceImageRecovery(staged?.media);
    const hasRecovery =
      error !== undefined ||
      imageRecovery !== nothing ||
      (view.issue !== undefined && Issue.Rejected.instanceOf(view.issue));
    return html`<sv-screen
      .navigation=${this.#navigation(view)}
      .heading=${this.ui.text(busy ? "experience.processingPhoto" : "experience.choosePhoto")}
      .statusMessage=${busy ? this.ui.text("experience.processingPhoto") : ""}
      stage-layout="centered"
    >
      <sv-image
        slot="stage"
        .src=${photo?.src}
        .loadKey=${photo?.loadKey}
        .crop=${photo?.crop}
        .framing=${photo?.framing}
        .alt=${this.ui.text("photo.previewAlt")}
        @sv-image-state=${(event: ImageStateEvent) => {
          this.#recordSourceImage(event, staged?.media);
        }}
      ></sv-image>
      ${
        hasRecovery
          ? html`<div slot="before-actions">
              ${this.#recovery(view, html`${this.#message(error)} ${imageRecovery}`)}
            </div>`
          : nothing
      }
      ${primary ?? nothing}
    </sv-screen>`;
  }

  #renderCamera(
    view: FlowView,
    { camera, canSwitch }: InstanceType<typeof ScreenView.Camera>["inner"],
  ) {
    const staged = view.photoChange?.newPhoto;
    if (staged !== undefined) {
      const photo = this.#photo(staged.photo.media);
      return html`<sv-photo-capture-screen
        .navigation=${this.#navigation(view)}
        state="uploading"
        .photoSrc=${photo?.src}
        .photoLoadKey=${photo?.loadKey}
        .photoCrop=${photo?.crop}
        .photoFraming=${photo?.framing}
        @sv-image-state=${(event: ImageStateEvent) => {
          this.#recordSourceImage(event, staged.photo.media);
        }}
        >${this.#recovery(view, html`${this.#sourceImageRecovery(staged.photo.media)}`)}
      </sv-photo-capture-screen>`;
    }
    let state: "permission" | "live" | "denied" | "unavailable" | "error" = "permission";
    let lease: string | undefined;
    let seconds = 0;
    let busy = true;
    let status: MessageId | undefined =
      view.domain.session === SessionPhase.Ready
        ? "experience.requestingCamera"
        : "experience.preparingSession";
    if (
      CameraState.Live.instanceOf(camera) ||
      CameraState.Capturing.instanceOf(camera) ||
      CameraState.Countdown.instanceOf(camera)
    ) {
      state = "live";
      ({ lease } = camera.inner);
      busy = CameraState.Capturing.instanceOf(camera);
      status = undefined;
      if (CameraState.Countdown.instanceOf(camera)) {
        seconds = Math.max(
          1,
          Math.ceil((Number(camera.inner.deadline) - performance.now()) / 1000),
        );
      }
    } else if (CameraState.Unavailable.instanceOf(camera)) {
      busy = false;
      status = undefined;
      if (camera.inner.error === DeviceError.PermissionDenied) {
        state = "denied";
      } else {
        state = camera.inner.error === DeviceError.Unavailable ? "unavailable" : "error";
      }
    }
    const source = lease === undefined ? undefined : this.experience?.adapters.getCamera(lease);
    let statusMessage = status === undefined ? undefined : this.ui.text(status);
    if (view.modal !== undefined && Modal.Picker.instanceOf(view.modal)) {
      statusMessage = this.ui.text("experience.choosingPhoto");
    }
    const captureError = view.issue !== undefined && Issue.CaptureFailed.instanceOf(view.issue);
    return html`<sv-photo-capture-screen
      .navigation=${this.#navigation(view)}
      .state=${state}
      .stream=${source?.stream}
      .canSwitchCamera=${canSwitch}
      .canStartTimer=${CameraState.Live.instanceOf(camera) && camera.inner.preview === CameraPreview.Ready}
      .busy=${busy || view.modal !== undefined}
      .canChoosePhoto=${view.modal === undefined && !CameraState.Capturing.instanceOf(camera)}
      .statusMessage=${statusMessage}
      .countdownSeconds=${seconds}
      @sv-photo-capture-action=${this.#cameraAction}
      @sv-camera-preview-state=${(event: HTMLElementEventMap["sv-camera-preview-state"]) => {
        if (lease === undefined || source?.stream !== event.detail.stream) {
          return;
        }
        const preview = {
          failed: CameraPreview.Failed,
          waiting: CameraPreview.Waiting,
          ready: CameraPreview.Ready,
        }[event.detail.state];
        this.#renderer?.completeDevice(
          new DeviceEvent.Camera({ event: new CameraEvent.Preview({ lease, preview }) }),
        );
      }}
      >${this.#recovery(view, html`${this.#message(captureError ? "experience.captureFailed" : this.#pickerError(view))}`)}</sv-photo-capture-screen
    >`;
  }

  #pickerError(view: FlowView): MessageId | undefined {
    return view.issue !== undefined && Issue.PickerFailed.instanceOf(view.issue)
      ? "experience.pickerFailed"
      : undefined;
  }

  #renderIntro(view: FlowView, consented: boolean) {
    const { domain, issue } = view;
    const restoringFailed = domain.session === SessionPhase.RestoreFailed;
    const creatingFailed = domain.session === SessionPhase.CreateFailed;
    let error = this.#pickerError(view);
    if (restoringFailed) {
      error = "experience.sessionRestoreFailed";
    } else if (creatingFailed) {
      error = "sessionIntro.createSessionError";
    } else if (issue !== undefined && Issue.SessionExpired.instanceOf(issue)) {
      error = "experience.sessionExpired";
    }
    const busy =
      view.modal !== undefined ||
      domain.session === SessionPhase.Restoring ||
      domain.session === SessionPhase.Creating;
    return html`<sv-session-intro-screen
      .navigation=${this.#navigation(view)}
      .recoveryOnly=${restoringFailed}
      .consented=${consented}
      .consentRequired=${domain.session !== SessionPhase.Ready}
      .busy=${busy}
      .photoFactsOpen=${this.#photoFactsOpen}
      .withdrawalOpen=${this.#withdrawalOpen}
      .error=${error === undefined ? undefined : this.ui.text(error)}
      .flowControlled=${true}
      .consentError=${issue !== undefined && Issue.ConsentRequired.instanceOf(issue) ? this.ui.text("sessionIntro.consentRequired") : undefined}
      @sv-session-intro-change=${this.#introChange}
      @sv-session-intro-action=${this.#introAction}
    >
      ${
        restoringFailed
          ? html` ${this.#button(
              "experience.retrySession",
              () => {
                this.#dispatch(new FlowAction.Session({ action: new SessionAction.Retry() }));
              },
              "primary",
            )}`
          : nothing
      }
      ${this.#recovery(view)}
    </sv-session-intro-screen>`;
  }

  #renderTryOn(view: FlowView, screen: InstanceType<typeof ScreenView.TryOn>) {
    const { domain } = view;
    const { selection, presentation } = screen.inner;
    const photoId = domain.photo?.media;
    const photo = this.#photo(photoId);
    const commerce: Record<VariantId, SvVariantCommerce> = Object.fromEntries(
      Object.entries(this.prices ?? this.#bound?.prices ?? {}).map(([id, price]) => [
        id,
        { price },
      ]),
    );
    for (const id of domain.unavailableVariants) {
      commerce[id] = { ...commerce[id], inStock: false };
    }
    const state = tryOnScreenState(view, screen);
    const results = tryOnResults(view);
    const shown = results.find(({ id }) => id === state.displayed);
    const image = view.renderMedia?.result;
    const imagePhase = image?.phase ?? ImagePhase.Loading;
    const actions = view.renderMedia;
    let resultState: "ready" | "error" | "loading" | undefined;
    if (shown !== undefined && view.presence.open) {
      resultState = "loading";
      if (imagePhase === ImagePhase.Ready) {
        resultState = "ready";
      } else if (imagePhase === ImagePhase.Failed) {
        resultState = "error";
      }
    }
    const heightStatus = bodyHeight(domain.body);
    const bodyRevision =
      heightStatus !== undefined && HeightStatus.Acknowledged.instanceOf(heightStatus)
        ? heightStatus.inner.revision
        : null;
    const { warning } = state;
    const progress =
      state.progressMessage === undefined ? undefined : this.ui.text(state.progressMessage);
    const status =
      progress ??
      (resultState === "loading" && state.progress !== TryOnProgress.Rendering
        ? this.ui.text("experience.loadingResultImage")
        : undefined);
    const error =
      state.failure === undefined
        ? undefined
        : this.ui.text(
            state.failure,
            state.requested === undefined ? undefined : { variant: state.requested },
          );
    let phase: "generating" | "ready" | "error" = error === undefined ? "ready" : "error";
    if (state.progress === TryOnProgress.Rendering) {
      phase = "generating";
    }
    return html`<sv-try-on-view-screen
      .navigation=${this.#navigation(view)}
      .state=${phase}
      .statusMessage=${status}
      .requestPending=${state.progress !== undefined}
      .retryVariantId=${state.retryVariantId}
      .error=${error}
      .busy=${view.modal !== undefined}
      .cartPending=${actions?.cart.pending}
      .cartAvailable=${actions?.cart.available === true}
      .downloadAvailable=${actions?.download.available === true}
      .downloadPending=${actions?.download.pending}
      .resultImageSrc=${this.#asset(image)?.src ?? null}
      .resultImageLoadKey=${imageLoadKey(image)}
      .resultImageState=${resultState}
      .productName=${this.productName}
      .product=${domain.product}
      .selection=${selection}
      .presentation=${presentation}
      .tryOns=${results}
      .bodyRevision=${bodyRevision}
      .commerce=${commerce}
      .photoSrc=${photo?.src}
      .photoLoadKey=${photo?.loadKey}
      .photoCrop=${photo?.crop}
      .photoFraming=${photo?.framing}
      .resultFraming=${this.resultFraming}
      .flowControlled=${true}
      .stockNotice=${view.issue !== undefined && Issue.StockUnavailable.instanceOf(view.issue) ? view.issue.inner : undefined}
      .fit=${state.displayed === undefined ? undefined : this.#fit(state.displayed, view)}
      .fitDetailsOpen=${this.#fitDetailsOpen}
      .activeCalloutKey=${this.#activeCalloutKey}
      @sv-try-on-view-change=${this.#tryOnChange}
      @sv-try-on-view-action=${this.#tryOnAction}
      @sv-image-state=${(event: ImageStateEvent) => {
        const [target] = event.composedPath();
        if (!(target instanceof SvImage)) {
          return;
        }
        if (Object.hasOwn(target.dataset, "result")) {
          this.#recordImage(event, image);
        } else {
          this.#recordSourceImage(event, photoId);
        }
      }}
    >
      ${this.#recovery(
        view,
        html`
          ${this.#message(warning)}
          ${this.#message(actions?.cart.failed === true ? "experience.cartFailed" : undefined)}
          ${shown === undefined ? this.#sourceImageRecovery(photoId) : nothing}
          ${this.#message(actions?.download.failed === true ? "experience.downloadFailed" : undefined)}
          ${this.#message(resultState === "error" ? "experience.resultImageFailed" : undefined)}
          ${progress === undefined ? nothing : html`<p aria-hidden="true">${progress}</p>`}
          ${
            state.suggestedLabel === undefined
              ? nothing
              : html`<p>
                  ${this.ui.text("experience.suggestedVariant", {
                    variant: state.suggestedLabel,
                  })}
                </p>`
          }
        `,
      )}
      <div class="picker-note" slot="picker-note">
        ${this.#message(state.noSize ? "experience.noSuitableSize" : undefined)}
        ${
          domain.sizeRecommendationPending && !state.savingHeight
            ? html`<p role="status">${this.ui.text("experience.recommendationPending")}</p>`
            : nothing
        }
        ${
          domain.sizeRecommendationError === undefined
            ? nothing
            : this.#message("experience.recommendationFailed")
        }
      </div>
    </sv-try-on-view-screen>`;
  }

  #renderScreen(view: FlowView) {
    const { screen, issue, domain } = view;
    const screenState = this.experience?.screen;
    const selectingPhoto = view.modal !== undefined && Modal.Picker.instanceOf(view.modal);
    if (screenState?.step === "photo-upload" && !screenState.showCamera) {
      return this.#renderStagedPhoto(view, screenState.phase);
    }
    if (ScreenView.Introduction.instanceOf(screen)) {
      return this.#renderIntro(view, screen.inner.consentGiven);
    }
    if (ScreenView.Camera.instanceOf(screen)) {
      return this.#renderCamera(view, screen.inner);
    }
    if (ScreenView.PhotoRejected.instanceOf(screen)) {
      const photo = this.#photo(screen.inner.photo.media);
      return html`<sv-photo-upload-rejected-screen
        .navigation=${this.#navigation(view)}
        .photoSrc=${photo?.src}
        .photoLoadKey=${photo?.loadKey}
        .photoCrop=${photo?.crop}
        .photoFraming=${photo?.framing}
        .busy=${selectingPhoto}
        .statusMessage=${selectingPhoto ? this.ui.text("experience.choosingPhoto") : ""}
        .error=${this.ui.text(PHOTO_REJECTION_MESSAGES[screen.inner.reason])}
        @sv-photo-upload-rejected-action=${this.#rejectedAction}
        @sv-image-state=${(event: ImageStateEvent) => {
          this.#recordSourceImage(event, screen.inner.photo.media);
        }}
        >${this.#recovery(
          view,
          html`
            ${this.#message(this.#pickerError(view))}
            ${this.#sourceImageRecovery(screen.inner.photo.media)}
          `,
        )}</sv-photo-upload-rejected-screen
      >`;
    }
    if (ScreenView.Height.instanceOf(screen)) {
      const photo = this.#photo(domain.photo?.media);
      const uncertain = uncertainBodyMessage(view);
      const savingHeight = heightPending(view);
      let statusMessage = "";
      if (selectingPhoto) {
        statusMessage = this.ui.text("experience.choosingPhoto");
      } else if (savingHeight) {
        statusMessage = this.ui.text("experience.savingHeight");
      }
      const heightError =
        issue !== undefined && Issue.SetHeightFailed.instanceOf(issue)
          ? issue.inner.error
          : undefined;
      const bodyMissing = BodyState.Missing.instanceOf(domain.body);
      let error = this.#pickerError(view);
      if (bodyMissing) {
        error = "experience.bodyMissing";
      } else if (view.heightNeedsChange) {
        error = "experience.heightUnusable";
      } else if (heightError !== undefined && heightError !== BackendError.Unusable) {
        error = "experience.heightFailed";
      }
      return html`<sv-height-setting-screen
        .navigation=${this.#navigation(view)}
        .photoSrc=${photo?.src}
        .photoLoadKey=${photo?.loadKey}
        .photoCrop=${photo?.crop}
        .photoFraming=${photo?.framing}
        .heightCm=${screen.inner.draft}
        .busy=${selectingPhoto}
        .statusMessage=${statusMessage}
        .confirmDisabled=${!view.canConfirmHeight}
        .error=${error === undefined ? undefined : this.ui.text(error)}
        @sv-height-setting-change=${this.#heightChange}
        @sv-height-setting-action=${this.#heightAction}
        @sv-image-state=${(event: ImageStateEvent) => {
          this.#recordSourceImage(event, domain.photo?.media);
        }}
        >${this.#recovery(
          view,
          html`
            ${this.#message(uncertain)} ${this.#sourceImageRecovery(domain.photo?.media)}
            ${savingHeight && !selectingPhoto ? html`<p>${statusMessage}</p>` : nothing}
          `,
        )}</sv-height-setting-screen
      >`;
    }
    return this.#renderTryOn(view, screen);
  }

  protected override render() {
    const view = this.#view;
    if (view === undefined) {
      return nothing;
    }
    if (this.experience?.failure !== undefined) {
      const dismiss = () => {
        this.experience?.close();
      };
      return html`<sv-dialog
        .open=${this.experience.failureVisible}
        .label=${this.ui.text("experience.endedUnexpectedly")}
        @sv-dismiss=${dismiss}
      >
        <div class="confirmation">
          ${this.#message("experience.endedUnexpectedly")}
          ${this.#button("surface.closeSr", dismiss)}
        </div>
      </sv-dialog>`;
    }
    const visible = view.presence.open && view.presence.foreground;
    // The machine releases render media on close. Keep the last frame until the native exit ends.
    if (visible || this.renderRoot.querySelector("sv-dialog")?.showing !== true) {
      this.#dialogContent = this.#renderScreen(view);
    }
    const cancelModal = () => {
      this.#dispatch(new FlowAction.Navigation({ action: NavigationAction.CancelModal }));
    };
    let photoModal: TemplateResult | typeof nothing = nothing;
    if (view.modal !== undefined && Modal.ChoosePhotoSource.instanceOf(view.modal)) {
      const confirmingRetake =
        view.domain.photo?.source === PhotoSource.Camera &&
        (ScreenView.Height.instanceOf(view.screen) || ScreenView.TryOn.instanceOf(view.screen));
      photoModal = confirmingRetake
        ? html`<sv-photo-retake-dialog
            .open=${visible}
            @sv-photo-retake-action=${(event: HTMLElementEventMap["sv-photo-retake-action"]) => {
              if (event.detail.action === "retake") {
                this.#beginPhoto(PhotoSource.Camera);
              } else {
                cancelModal();
              }
            }}
          ></sv-photo-retake-dialog>`
        : html`<sv-dialog
            data-photo-source
            .open=${visible}
            .label=${this.ui.text("experience.choosePhoto")}
            @sv-dismiss=${cancelModal}
          >
            <div class="confirmation">
              <p>${this.ui.text("experience.choosePhoto")}</p>
              ${this.#button(
                "experience.takePhoto",
                () => {
                  this.#beginPhoto(PhotoSource.Camera);
                },
                "primary",
              )}
              ${this.#button("experience.chooseFromLibrary", () => {
                this.#beginPhoto(PhotoSource.Library);
              })}
              ${this.#button("experience.cancel", cancelModal)}
            </div>
          </sv-dialog>`;
    }
    return html`
      <sv-dialog
        .open=${visible}
        .label=${this.productName ?? this.ui.text("sessionIntro.sheetTitle")}
        @sv-back=${this.#back}
        @sv-dismiss=${this.#close}
        @sv-dialog-closed=${() => {
          this.requestUpdate();
        }}
      >
        ${this.#dialogContent}
      </sv-dialog>
      ${photoModal}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sv-try-on-experience": SvTryOnExperience;
  }
  interface HTMLElementEventMap {
    "sv-try-on-experience-error": CustomEvent<unknown>;
  }
}
