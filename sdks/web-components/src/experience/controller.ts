import type {
  EffectBatch,
  FlowConfig,
  FlowView,
  HostProduct,
  InitialProductInstallation,
  Job,
  LeaseId,
  MediaId,
  OperationId,
  Outcome,
  TryOnId,
  TryOnAsset,
  InteractionToken,
  ImageView,
  CartRequest,
} from "@studio-vaai/core";
import type { ProductDetails } from "@studio-vaai/core/api";

import {
  DefaultTryOnFlow,
  DeviceEffect,
  DeviceEvent,
  DomainCommand,
  DomainEffect,
  Effect,
  EffectDriver,
  FlowAction,
  PresenceAction,
  RenderMediaAction,
  RenderMediaEffect,
  RenderMediaOutcome,
  renderMediaTimeoutMs,
  PresentationAction,
  ProductInstallationStatus,
  Rejection,
  SelectionAction,
  SessionCommand,
  TryOnError,
  TryOnCommand,
  TryOnSession,
  initializeCore,
  experienceCloseAfterHostFailure,
} from "@studio-vaai/core";

import type { SvCameraCapture } from "../components/camera/sv-camera.js";
import type { SvImageCrop } from "../media/image-crop.js";
import type { SvImageFraming } from "../media/image-framing.js";
import type { ApiTryOnResult } from "./api/fit.js";
import type { PresentProduct, ProductCommerce, TryOnProductReference } from "./api/product.js";
import type {
  TryOnExperienceEntry,
  TryOnExperienceEvent,
  TryOnExperienceEventMap,
} from "./events.js";

import { productPresentationFor } from "./api/product.js";
import { cartDetail, experienceEvent } from "./event-projection.js";
import { experienceScreen } from "./presentation.js";

type EffectEvent = Extract<Effect, { inner: { event: unknown } }>;
type ViewListener = () => void | Promise<void>;
type CartHandler = (
  detail: TryOnExperienceEventMap["sv-try-on-add-to-cart-requested"],
) => void | Promise<void>;
type MediaHandler = (
  kind: "recover" | "renew-download" | "download",
  image: ImageView,
  signal: AbortSignal,
) => Promise<RenderMediaOutcome>;
type CameraCapture = (stream: MediaStream) => Promise<SvCameraCapture>;

interface RendererHandlers {
  capture?: CameraCapture;
  media: MediaHandler;
  cart(): CartHandler | undefined;
  resourcesChanged(): void;
}

export interface TryOnRenderer {
  token: InteractionToken;
  dispatch(action: FlowAction, shopper?: boolean): FlowView | undefined;
  completeDevice(event: DeviceEvent): void;
  setForeground(foreground: boolean): void;
  setCartAvailable(available: boolean): void;
  detach(): void;
}

type EventListener = (event: TryOnExperienceEvent) => void | Promise<void>;
export interface TryOnExperiencePhoto {
  src: string;
  /** Signed source metadata to report to the flow. */
  signed?: { asset: InteractionToken; expiresAt: number };
  crop?: SvImageCrop | undefined;
  framing?: SvImageFraming | undefined;
}

/** Storefront option IDs keyed by catalogue axis. Omit axes the shopper has not chosen. */
export type StorefrontSelection = Readonly<Record<string, string>>;

export interface TryOnExperienceCamera {
  stream: MediaStream;
}

/** Browser resources stay in the adapters. Rust receives only IDs and typed outcomes. */
export interface TryOnExperienceAdapters {
  /** Connects API work to the accepted results in the Rust session. */
  bindSession?(
    session: TryOnSession,
    replaceImage: (expected: TryOnAsset, imageUrl: string) => void,
  ): void;
  /** Runs the job using the inputs captured by Rust. */
  runJob(job: Job, operation: OperationId): Outcome | Promise<Outcome>;
  applyDomainEffect(effect: Exclude<DomainEffect, InstanceType<typeof DomainEffect.Start>>): void;
  startDeviceEffect(
    effect: Exclude<
      DeviceEffect,
      InstanceType<typeof DeviceEffect.Cart | typeof DeviceEffect.RenderMedia>
    >,
    capture?: CameraCapture,
  ): DeviceEvent | undefined | Promise<DeviceEvent | undefined>;
  getPhoto(id: MediaId): TryOnExperiencePhoto | undefined;
  getCamera(id: LeaseId): TryOnExperienceCamera | undefined;
  getProductDetails?(productId: string, signal?: AbortSignal): Promise<ProductDetails>;
  getProductByForeignId?(foreignId: string, signal?: AbortSignal): Promise<ProductDetails>;
  getResult?(id: string): ApiTryOnResult | undefined;
  subscribeResults?(listener: () => void): () => void;
  /** Throw ImageFetchError for a failed HTTP response so the flow can evaluate renewal. */
  fetchImage?(src: string, signal: AbortSignal): Promise<Blob>;
  refreshPhoto?(id: MediaId, expectedSrc?: string, signal?: AbortSignal): Promise<void>;
  /** Renews the current result image URL. */
  refreshResult?(id: TryOnId, signal: AbortSignal, expectedSrc?: string): Promise<void>;
  checkSession?(): void;
  subscribeSessionCommands?(listener: (command: SessionCommand) => void): () => void;
  onEvent?(event: EffectEvent): void;
  finishJob?(operation: OperationId): void;
  /** Release resources and cancel pending work, including any late device acquisitions. */
  dispose(): void;
}

type VariantPrices = Readonly<Record<string, string>>;
interface ProductCommerceState {
  initial: ProductCommerce | undefined;
  prices: VariantPrices;
}
type InstallationCommerce = ProductCommerce | readonly string[];
type ReadInstallationCommerce = InstallationCommerce | (() => InstallationCommerce | undefined);

function isStockList(commerce: InstallationCommerce | undefined): commerce is readonly string[] {
  return Array.isArray(commerce);
}

export function resolveCommerce(initial?: ProductCommerce, live?: ProductCommerce) {
  const unavailableVariants: string[] = [];
  const priceEntries: [string, string][] = [];
  for (const id of new Set([...Object.keys(initial ?? {}), ...Object.keys(live ?? {})])) {
    const price = live?.[id]?.price ?? initial?.[id]?.price;
    if (price !== undefined) {
      priceEntries.push([id, price]);
    }
    if ((live?.[id]?.inStock ?? initial?.[id]?.inStock) === false) {
      unavailableVariants.push(id);
    }
  }
  return {
    prices: Object.freeze(Object.fromEntries(priceEntries)),
    unavailableVariants: unavailableVariants.toSorted(),
  };
}

/** Owns one Rust session, its default flow and its exclusive effect driver. */
export class TryOnExperience {
  readonly adapters: TryOnExperienceAdapters;
  readonly #session: TryOnSession;
  readonly #flow: DefaultTryOnFlow;
  readonly #driver: EffectDriver;
  readonly #listeners = new Set<ViewListener>();
  readonly #eventListeners = new Set<EventListener>();
  #view: FlowView;
  readonly #mediaWork = new Map<InteractionToken, AbortController>();
  readonly #renderers = new Map<InteractionToken, RendererHandlers>();
  #draining = false;
  #resourcesChanged = false;
  #disposed = false;
  #failure: unknown;
  #productDetails: ProductDetails | undefined;
  #commerce: (ProductCommerceState & { installation: InteractionToken }) | undefined;
  #installedForeignId: string | undefined;
  #productRequest: { resolving: boolean } | undefined;
  #failureVisible = false;
  readonly #unsubscribeResults: (() => void) | undefined;
  readonly #unsubscribeSession: (() => void) | undefined;

  get screen(): ReturnType<typeof experienceScreen> {
    return experienceScreen(this.#view);
  }

  private constructor(
    config: FlowConfig,
    adapters: TryOnExperienceAdapters,
    initial?: InitialProductInstallation,
  ) {
    this.adapters = adapters;
    this.#session = new TryOnSession({
      runtimeId: crypto.randomUUID(),
      maxTryOnRequests: 64,
    });
    try {
      const flow =
        initial === undefined
          ? new DefaultTryOnFlow(this.#session, config)
          : DefaultTryOnFlow.withInstallation(this.#session, config, initial);
      if (!DefaultTryOnFlow.instanceOf(flow)) {
        throw new Error("Could not create the try-on flow.");
      }
      this.#flow = flow;
    } catch (error) {
      this.#session.uniffiDestroy();
      throw error;
    }
    const driver = this.#session.claimEffectDriver();
    if (!EffectDriver.instanceOf(driver)) {
      throw new Error("Could not claim the try-on effect driver.");
    }
    this.#driver = driver;
    this.#view = this.#flow.view();
    adapters.bindSession?.(this.#session, (expected, imageUrl) => {
      if (!this.#disposed) {
        this.#commit(() =>
          this.#session.command(
            new DomainCommand.TryOn({
              command: new TryOnCommand.ReplaceImage({ expected, imageUrl }),
            }),
          ),
        );
      }
    });
    this.#unsubscribeResults = adapters.subscribeResults?.(() => {
      if (this.#draining) {
        this.#resourcesChanged = true;
      } else {
        const before = this.#view;
        this.#rendererFor(this.#view.renderer)?.resourcesChanged();
        if (this.#view === before) {
          this.#notify();
        }
      }
    });
    this.#unsubscribeSession = adapters.subscribeSessionCommands?.((command) => {
      this.#sessionCommand(command);
    });
    this.#drain();
  }

  static async create(
    config: FlowConfig,
    adapters: TryOnExperienceAdapters,
    productDetails?: ProductDetails,
    initial?: InitialProductInstallation & { foreignId?: string; commerce?: ProductCommerceState },
  ): Promise<TryOnExperience> {
    await initializeCore();
    const experience = new TryOnExperience(
      config,
      adapters,
      initial === undefined
        ? undefined
        : {
            token: initial.token,
            active: initial.active,
            unavailableVariants: initial.unavailableVariants,
          },
    );
    experience.#productDetails = productDetails;
    experience.#installedForeignId = initial?.foreignId;
    if (initial?.commerce !== undefined) {
      experience.#commerce = { ...initial.commerce, installation: initial.token };
    }
    return experience;
  }

  get view(): FlowView {
    return this.#view;
  }

  /** Formatted prices for the ready product installation. */
  get prices(): VariantPrices | undefined {
    return this.#commerce?.installation === this.#view.readyInstallation
      ? this.#commerce?.prices
      : undefined;
  }

  get failure(): unknown {
    return this.#failure;
  }

  get failureVisible(): boolean {
    return this.#failureVisible;
  }

  subscribe(listener: ViewListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  attachRenderer(
    foreground: boolean,
    canAddToCart: boolean,
    handlers: RendererHandlers,
  ): TryOnRenderer | undefined {
    if (this.#disposed) {
      return undefined;
    }
    if (foreground) {
      this.adapters.checkSession?.();
    }
    const token = this.#commit(() => {
      const update = this.#flow.dispatch(
        new FlowAction.RenderMedia({
          action: new RenderMediaAction.Attach({ foreground, canAddToCart }),
        }),
      );
      const token = update.view.renderer;
      if (token !== undefined) {
        this.#renderers.set(token, handlers);
      }
      return token;
    });
    if (token === undefined || this.#disposed) {
      return undefined;
    }
    const dispatch = (action: FlowAction, shopper = false) =>
      this.#disposed
        ? undefined
        : this.#commit(() => this.#flow.dispatchFromRenderer(token, action, shopper).view);
    return {
      token,
      dispatch,
      completeDevice: (event) => {
        if (!this.#disposed) {
          this.#commit(() => this.#flow.completeDeviceFromRenderer(token, event));
        }
      },
      setForeground: (foreground) => {
        if (!this.#disposed && foreground && this.#flow.view().renderer === token) {
          this.adapters.checkSession?.();
        }
        dispatch(
          new FlowAction.Presence({
            action: foreground ? PresenceAction.Resume : PresenceAction.Suspend,
          }),
        );
      },
      setCartAvailable: (available) => {
        dispatch(
          new FlowAction.RenderMedia({
            action: new RenderMediaAction.SetCartAvailable({ renderer: token, available }),
          }),
        );
      },
      detach: () => {
        dispatch(
          new FlowAction.RenderMedia({ action: new RenderMediaAction.Detach({ renderer: token }) }),
        );
      },
    };
  }

  /** Observe future facts after their effect batches have been acknowledged. */
  subscribeEvents(listener: EventListener): () => void {
    if (!this.#disposed) {
      this.#eventListeners.add(listener);
    }
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  open(entry: TryOnExperienceEntry = {}): boolean {
    if (this.#disposed || this.#failure !== undefined || this.#productRequest?.resolving === true) {
      return false;
    }
    try {
      const update = this.#commit(() =>
        this.#flow.dispatch(new FlowAction.OpenWithEntry({ entry })),
      );
      const view = this.#draining ? update?.view : this.#view;
      return !this.#disposed && view?.presence.open === true;
    } catch (error) {
      if (
        TryOnError.Rejected.instanceOf(error) &&
        Rejection.NoProductShown.instanceOf(error.inner.reason)
      ) {
        return false;
      }
      throw error;
    }
  }

  /** Reports a decoded image with the display token from its render. */
  reportPresented(id: TryOnId, token: InteractionToken): void {
    this.dispatch(
      new FlowAction.Presentation({
        action: new PresentationAction.ImageReady({ tryOnId: id, token }),
      }),
    );
  }

  /** The accepted installation for these host inputs, if the shopper can open it. */
  readyInstallation(
    product: string | TryOnProductReference,
    request: InteractionToken | undefined,
  ): InteractionToken | undefined {
    const installation = this.#view.productInstallation;
    const matches =
      typeof product === "object" && "foreignId" in product
        ? this.#installedForeignId === product.foreignId
        : installation?.productId === (typeof product === "string" ? product : product.productId);
    return this.#failure === undefined &&
      !this.#disposed &&
      this.#productRequest?.resolving !== true &&
      installation?.request === request &&
      matches
      ? this.#view.readyInstallation
      : undefined;
  }

  /** Resolve and install the host's product, display model and stock as one update. */
  async installProduct(
    product: string | TryOnProductReference,
    present: PresentProduct,
    commerce?: ReadInstallationCommerce,
    signal?: AbortSignal,
    request: InteractionToken = crypto.randomUUID(),
  ): Promise<boolean> {
    signal?.throwIfAborted();
    if (this.#disposed) {
      return false;
    }
    const pending = { resolving: typeof product !== "string" && "foreignId" in product };
    this.#productRequest = pending;
    if (typeof product === "string" || "productId" in product) {
      return await this.#installProduct(
        typeof product === "string" ? product : product.productId,
        present,
        commerce,
        signal,
        request,
        pending,
      );
    }

    const { foreignId } = product;
    const cached = this.#installedForeignId === foreignId ? this.#productDetails : undefined;
    if (cached === undefined) {
      const previous = this.#view;
      this.close();
      if (this.#view === previous) {
        this.#notify();
      }
    }
    const details = cached ?? (await this.adapters.getProductByForeignId?.(foreignId, signal));
    signal?.throwIfAborted();
    if (this.#disposed || this.#productRequest !== pending) {
      return false;
    }
    if (details === undefined) {
      throw new Error("Could not resolve the requested storefront product.");
    }
    pending.resolving = false;
    return await this.#installProduct(
      details.productId,
      present,
      commerce,
      signal,
      request,
      pending,
      {
        foreignId,
        details,
      },
    );
  }

  async #installProduct(
    productId: string,
    present: PresentProduct,
    commerce: ReadInstallationCommerce | undefined,
    signal: AbortSignal | undefined,
    request: InteractionToken,
    pending: { resolving: boolean },
    resolved?: { foreignId: string; details: ProductDetails },
  ): Promise<boolean> {
    const installation = this.#commit(
      () =>
        this.#flow.dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.BeginProductInstallation({ productId, token: request }),
          }),
        ).view.productInstallation,
    );
    if (installation === undefined || this.#disposed || this.#productRequest !== pending) {
      return false;
    }
    const { token } = installation;
    const finish = (
      hostProduct?: HostProduct,
      unavailableVariants: string[] = [],
      commerceState?: ProductCommerceState,
    ) => {
      if (this.#disposed) {
        return;
      }
      return this.#commit(() => {
        const installed = this.#flow.dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.FinishProductInstallation({
              token,
              ...(hostProduct === undefined ? {} : { hostProduct }),
              unavailableVariants,
            }),
          }),
        ).view.productInstallation;
        if (installed?.token === token && installed.status === ProductInstallationStatus.Ready) {
          this.#commerce = commerceState && { ...commerceState, installation: token };
        }
        return installed;
      });
    };
    try {
      const details =
        resolved?.details ??
        (this.#productDetails?.productId === productId
          ? this.#productDetails
          : await this.adapters.getProductDetails?.(productId, signal));
      signal?.throwIfAborted();
      if (this.#disposed || this.#productRequest !== pending) {
        return false;
      }
      if (details?.productId !== productId) {
        throw new Error("Could not resolve the requested try-on product.");
      }
      const { hostProduct, commerce: initial } = productPresentationFor(details, present);
      const live = typeof commerce === "function" ? commerce() : commerce;
      const snapshot = resolveCommerce(initial, isStockList(live) ? undefined : live);
      const unavailable = isStockList(live) ? [...live] : snapshot.unavailableVariants;
      if (this.#disposed || this.#productRequest !== pending) {
        return false;
      }
      this.#productDetails = details;
      this.#installedForeignId = resolved?.foreignId;
      const installed = finish(hostProduct, unavailable, { initial, prices: snapshot.prices });
      if (
        this.#disposed ||
        this.#productRequest !== pending ||
        installed?.token !== token ||
        installed.status !== ProductInstallationStatus.Ready
      ) {
        return false;
      }
      return true;
    } catch (error) {
      finish();
      throw error;
    }
  }

  setProductActive(active: boolean): void {
    this.dispatch(
      new FlowAction.Selection({
        action: new SelectionAction.SetProductActive({ active }),
      }),
    );
  }

  /** Updates the picker for the installed product using the storefront’s option IDs. */
  setSelection(selection: StorefrontSelection): void {
    const installation = this.#view.readyInstallation;
    if (this.#productRequest?.resolving === true) {
      return;
    }
    this.dispatch(
      new FlowAction.Selection({
        action: new SelectionAction.SetStorefrontSelection({
          options: new Map(Object.entries(selection)),
          ...(installation === undefined ? {} : { installation }),
        }),
      }),
    );
  }

  /** Replace live commerce overrides for the supplied product installation. */
  updateCommerce(commerce: ProductCommerce | undefined, installation: InteractionToken): void {
    if (
      this.#disposed ||
      this.#failure !== undefined ||
      this.#productRequest?.resolving === true ||
      this.#view.readyInstallation !== installation
    ) {
      return;
    }
    const previousPrices = this.prices;
    const previousView = this.#view;
    const initial = this.#commerce?.initial;
    const { prices, unavailableVariants } = resolveCommerce(initial, commerce);
    this.#commerce = { initial, prices, installation };
    this.setUnavailableVariants(unavailableVariants, installation);
    if (
      this.#view === previousView &&
      (Object.keys(previousPrices ?? {}).length !== Object.keys(prices).length ||
        Object.entries(prices).some(([id, price]) => previousPrices?.[id] !== price))
    ) {
      this.#notify();
    }
  }

  /** Reports stock for the supplied installation. Omit the token only for an unmanaged product. */
  setUnavailableVariants(variantIds: readonly string[], installation?: InteractionToken): void {
    this.dispatch(
      new FlowAction.Selection({
        action: new SelectionAction.SetUnavailableVariants({
          variantIds: [...variantIds],
          ...(installation === undefined ? {} : { installation }),
        }),
      }),
    );
  }

  close(): void {
    if (this.#failureVisible) {
      this.#failureVisible = false;
      this.#notify();
      this.#listeners.clear();
      return;
    }
    this.dispatch(new FlowAction.Presence({ action: PresenceAction.Close }));
  }

  #sessionCommand(command: SessionCommand): void {
    if (!this.#disposed) {
      this.#commit(() => {
        this.#session.command(new DomainCommand.Session({ command }));
      });
    }
  }

  /** Deliver the first effect batch synchronously, including native picker activation. */
  dispatch(action: FlowAction): void {
    if (this.#disposed) {
      return;
    }
    if (FlowAction.Presence.instanceOf(action) && action.inner.action === PresenceAction.Resume) {
      this.adapters.checkSession?.();
    }
    this.#commit(() => {
      this.#flow.dispatch(action);
    });
  }

  dispatchShopper(action: FlowAction): void {
    if (!this.#disposed) {
      this.#commit(() => {
        this.#flow.dispatchShopper(action);
      });
    }
  }

  completeDevice(event: DeviceEvent): void {
    if (this.#disposed) {
      return;
    }
    this.#commit(() => {
      this.#flow.completeDevice(event);
    });
  }

  #commit<T>(input: () => T): T | undefined {
    let result: T;
    try {
      result = input();
    } catch (error) {
      if (!TryOnError.QueueFull.instanceOf(error) || this.#draining) {
        throw error;
      }
      this.#drain();
      if (this.#disposed) {
        return;
      }
      result = input();
    }
    this.#drain();
    return result;
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      void this.#notifyListener(listener);
    }
  }

  async #notifyListener(listener: ViewListener): Promise<void> {
    try {
      await listener();
    } catch {
      // A host observer cannot interrupt the effect driver or other observers.
    }
  }

  #accept(batch: EffectBatch): void {
    const { before, after } = batch.flow ?? {};
    // All work admitted by the previous renderer has started in earlier batches.
    if (before?.renderer !== undefined && before.renderer !== after?.renderer) {
      this.#renderers.delete(before.renderer);
    }
    if (after !== undefined) {
      this.#view = after;
    }
    for (const effect of batch.effects) {
      if (Effect.DomainEvent.instanceOf(effect) || Effect.FlowEvent.instanceOf(effect)) {
        try {
          this.adapters.onEvent?.(effect);
        } catch {
          // An observer cannot interrupt acknowledged delivery.
        }
      }
    }
    for (const fact of batch.experienceEvents) {
      const event = experienceEvent(fact);
      if (event !== undefined) {
        this.#publishEvent(event);
      }
    }
    if (after !== undefined || this.#resourcesChanged) {
      this.#resourcesChanged = false;
      this.#notify();
    }
  }

  #publishEvent(event: TryOnExperienceEvent): void {
    Object.freeze(event.detail);
    Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        const delivery = listener(event);
        if (delivery !== undefined) {
          // oxlint-disable-next-line promise/prefer-await-to-then -- Subscribers must never delay delivery.
          void delivery.catch(() => {
            // The publisher owns its retry policy.
          });
        }
      } catch {
        // Observers cannot interrupt delivery or the shopper's flow.
      }
    }
  }

  #drain(): void {
    if (this.#draining || this.#disposed) {
      return;
    }
    this.#draining = true;
    try {
      for (
        let batch = this.#driver.nextBatch();
        batch !== undefined;
        batch = this.#driver.nextBatch()
      ) {
        try {
          for (const effect of batch.effects) {
            this.#start(effect, batch.flow?.after);
          }
        } catch (error) {
          this.#driver.halt(batch.id);
          this.#fail(error, batch.flow?.after);
          return;
        }
        this.#driver.acknowledge(batch.id);
        this.#accept(batch);
      }
    } catch (error) {
      this.#fail(error);
    } finally {
      this.#draining = false;
    }
  }

  #rendererFor(token: InteractionToken | undefined): RendererHandlers | undefined {
    return token === undefined ? undefined : this.#renderers.get(token);
  }

  #start(effect: Effect, view: FlowView | undefined): void {
    if (Effect.DomainEffect.instanceOf(effect)) {
      const domain = effect.inner.effect;
      if (DomainEffect.Start.instanceOf(domain)) {
        const { job, operation } = domain.inner;
        void this.#finish(this.adapters.runJob(job, operation), (outcome) => {
          try {
            this.#commit(() => {
              this.#session.complete({ operation, outcome });
            });
          } finally {
            this.adapters.finishJob?.(operation);
          }
        });
      } else {
        this.adapters.applyDomainEffect(domain);
      }
    } else if (Effect.DeviceEffect.instanceOf(effect)) {
      const device = effect.inner.effect;
      // Use the renderer in the exact Rust commit that emitted this work.
      // An observer may already have committed a replacement further down the outbox.
      const renderer = this.#rendererFor(view?.renderer);
      if (DeviceEffect.RenderMedia.instanceOf(device)) {
        const work = device.inner.effect;
        if (RenderMediaEffect.ObserveSource.instanceOf(work)) {
          this.#observeSource(work.inner.media);
        } else if (RenderMediaEffect.PrepareSource.instanceOf(work)) {
          void this.#prepareSource(work.inner.media, work.inner.asset);
        } else if (RenderMediaEffect.Cancel.instanceOf(work)) {
          this.#mediaWork.get(work.inner.work)?.abort();
        } else {
          const { image, work: token } = work.inner;
          let kind: Parameters<MediaHandler>[0] = "download";
          if (RenderMediaEffect.Recover.instanceOf(work)) {
            kind = "recover";
          } else if (RenderMediaEffect.RenewForDownload.instanceOf(work)) {
            kind = "renew-download";
          }
          void this.#runMedia(kind, image, token, renderer?.media);
        }
        return;
      }
      if (DeviceEffect.Cart.instanceOf(device)) {
        void this.#runCart(device.inner.request, view ?? this.#view, renderer?.cart());
        return;
      }
      void this.#finish(this.adapters.startDeviceEffect(device, renderer?.capture), (event) => {
        if (event !== undefined) {
          this.completeDevice(event);
        }
      });
    }
  }

  #observeSource(media: MediaId): void {
    const signed = this.adapters.getPhoto(media)?.signed;
    if (signed !== undefined && Number.isSafeInteger(signed.expiresAt)) {
      this.dispatch(
        new FlowAction.RenderMedia({
          action: new RenderMediaAction.SourceAssetObserved({
            media,
            asset: signed.asset,
            expiresAt: BigInt(Math.max(0, signed.expiresAt)),
            now: BigInt(Date.now()),
          }),
        }),
      );
    }
  }

  async #prepareSource(media: MediaId, asset: InteractionToken): Promise<void> {
    const photo = this.adapters.getPhoto(media);
    if (photo?.signed?.asset === asset) {
      try {
        await this.adapters.refreshPhoto?.(media, photo.src);
      } catch {
        // A subsequent decode failure can request recovery.
      }
    }
  }

  async #runMedia(
    kind: "recover" | "renew-download" | "download",
    image: ImageView,
    work: InteractionToken,
    media: MediaHandler | undefined,
  ): Promise<void> {
    const request = new AbortController();
    this.#mediaWork.set(work, request);
    let outcome = RenderMediaOutcome.Failed;
    try {
      if (media !== undefined) {
        outcome = await media(
          kind,
          image,
          AbortSignal.any([request.signal, AbortSignal.timeout(renderMediaTimeoutMs())]),
        );
      }
    } catch {
      // Report a failure for this work only. Rust decides whether it is still current.
    } finally {
      this.#mediaWork.delete(work);
    }
    if (!request.signal.aborted) {
      try {
        this.completeDevice(new DeviceEvent.RenderMedia({ event: { work, outcome } }));
      } catch (error) {
        this.#fail(error);
      }
    }
  }

  async #runCart(
    request: CartRequest,
    view: FlowView,
    handler: CartHandler | undefined,
  ): Promise<void> {
    const { step } = experienceScreen(view);
    await Promise.resolve();
    let added = false;
    try {
      if (handler !== undefined) {
        await handler(cartDetail(request, step));
        added = true;
      }
    } catch {
      // The storefront reports failure through the cart outcome.
    }
    try {
      this.completeDevice(new DeviceEvent.Cart({ event: { token: request.token, added } }));
    } catch (error) {
      this.#fail(error);
    }
  }

  async #finish<T>(work: T | Promise<T>, complete: (value: T) => void): Promise<void> {
    try {
      const value = await work;
      if (!this.#disposed) {
        complete(value);
      }
    } catch (error) {
      this.#fail(error);
    }
  }

  #fail(error: unknown, failedView?: FlowView): void {
    if (this.#disposed || this.#failure !== undefined) {
      return;
    }
    this.#failure = error ?? new Error("The try-on experience failed.");
    const before = this.#view;
    this.#failureVisible = (failedView ?? before).presence.open;
    if (!this.#draining) {
      try {
        this.#flow.dispatch(new FlowAction.Presence({ action: PresenceAction.Dispose }));
        this.#drain();
      } catch {
        // If Rust cannot commit a close, the host still releases its resources.
      }
    }
    const closedInFlow = before.presence.open && !this.#view.presence.open;
    try {
      this.#release();
    } catch {
      // Keep the original failure visible even if cleanup also fails.
    }
    this.#notify();
    if (!this.#failureVisible) {
      this.#listeners.clear();
    }
    if (!closedInFlow) {
      const fact = experienceCloseAfterHostFailure(before);
      const event = fact === undefined ? undefined : experienceEvent(fact);
      if (event !== undefined) {
        this.#publishEvent(event);
      }
    }
    this.#eventListeners.clear();
  }

  #release(): void {
    this.#disposed = true;
    this.#unsubscribeResults?.();
    this.#unsubscribeSession?.();
    this.#renderers.clear();
    for (const request of this.#mediaWork.values()) {
      request.abort();
    }
    try {
      this.adapters.dispose();
    } finally {
      this.#driver.uniffiDestroy();
      this.#flow.uniffiDestroy();
      this.#session.uniffiDestroy();
    }
  }

  dispose(): void {
    if (this.#disposed) {
      this.close();
      return;
    }
    if (this.#draining) {
      // A storefront may remove the experience while handling a cart event.
      queueMicrotask(() => {
        this.dispose();
      });
      return;
    }
    try {
      this.#commit(() => {
        this.#flow.dispatch(new FlowAction.Presence({ action: PresenceAction.Dispose }));
      });
      if (!this.#disposed) {
        this.#session.command(new DomainCommand.Session({ command: new SessionCommand.Dispose() }));
        this.#drain();
      }
    } finally {
      if (!this.#disposed) {
        this.#release();
      }
      this.#listeners.clear();
      this.#eventListeners.clear();
    }
  }
}
