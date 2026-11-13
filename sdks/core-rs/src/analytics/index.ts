import type { TryOnExperienceEvent, TryOnExperienceStep } from "../experience/events.js";

import {
  AnalyticsEvent,
  AnalyticsImageSource,
  AnalyticsStep,
  ApiClient,
  ExperimentAssignedDataVariant,
  ImageUploadedDataImageSource,
} from "../../build/wasm2/api.js";
import manifest from "../../package.json";
import { browserTransport } from "../browser-transport.js";
import { initializeCore } from "../runtime.js";

export interface AnalyticsOptions {
  clientApiKey: string;
  /** SDK integrations can identify their own package and version. */
  sdkVersion?: string;
  baseUrl?: string;
  /** The storefront may turn collection on or off as its consent state changes. */
  enabled: () => boolean;
  visitorId?: () => string;
  fetch?: typeof fetch;
}

let visitor: { day: string; id: string } | undefined;

export function getAnalyticsVisitorId(): string {
  if (typeof window === "undefined") {
    return crypto.randomUUID();
  }
  const day = new Date().toISOString().slice(0, 10);
  if (visitor?.day !== day) {
    visitor = { day, id: crypto.randomUUID() };
  }
  return visitor.id;
}

const steps = {
  intro: new AnalyticsStep.Intro(),
  camera: new AnalyticsStep.ImageRecord(),
  "photo-upload": new AnalyticsStep.ImageUpload(),
  "photo-rejected": new AnalyticsStep.ImageRejection(),
  height: new AnalyticsStep.Height(),
  "variant-selection": new AnalyticsStep.VariantSelection(),
  "try-on": new AnalyticsStep.TryOn(),
};

function imageSource(step: TryOnExperienceStep | undefined): AnalyticsImageSource {
  // oxlint-disable-next-line eslint/default-case -- Every possible step is covered.
  switch (step) {
    case "height": {
      return new AnalyticsImageSource.Height();
    }
    case "variant-selection":
    case "try-on": {
      return new AnalyticsImageSource.VariantSelection();
    }
    case "photo-rejected": {
      return new AnalyticsImageSource.ImageRejection();
    }
    case "intro":
    case "camera":
    case "photo-upload":
    case undefined: {
      return new AnalyticsImageSource.Intro();
    }
  }
}

function context(visitorId: () => string) {
  const id = visitorId().slice(0, 50);
  if (typeof window === "undefined") {
    return { id };
  }
  const [referrer] = globalThis.document.referrer.split(/[?#]/u, 1);
  return {
    id,
    hostname: globalThis.location.hostname,
    url: globalThis.location.pathname,
    language: globalThis.navigator.language,
    screen: `${globalThis.screen.width}x${globalThis.screen.height}`,
    title: globalThis.document.title,
    ...(referrer !== undefined && referrer !== "" && { referrer }),
  };
}

export interface CommerceAnalyticsEvent {
  productId: string;
  foreignIds: Readonly<Record<string, string>>;
}

/** Publishes the existing collector catalogue via the generated, unauthenticated API method. */
export function createTryOnAnalytics(options: AnalyticsOptions): TryOnAnalytics {
  let client: Promise<ApiClient> | undefined;
  let disposed = false;
  const inFlight = new Set<Promise<void>>();
  const visitorId = options.visitorId ?? getAnalyticsVisitorId;
  const sdkVersion = options.sdkVersion ?? `${manifest.name}@${manifest.version}`;
  const common = (productId: string) => ({ productId, sdkVersion });
  const browserContext = () => context(visitorId);

  function variantData({ productId, foreignIds }: CommerceAnalyticsEvent) {
    const additional = new Map<string, string>();
    for (const [axis, value] of Object.entries(foreignIds)) {
      if (axis !== "size" && axis !== "colorway") {
        additional.set(`variant-${axis}`, value);
      }
    }
    const { size, colorway } = foreignIds;
    return {
      ...common(productId),
      ...(size !== undefined && { variantSize: size }),
      ...(colorway !== undefined && { variantColorway: colorway }),
      additional,
    };
  }

  async function connect(): Promise<ApiClient> {
    try {
      await initializeCore();
      return new ApiClient(
        {
          baseUrl: options.baseUrl ?? "https://a.studio-vaai.com",
          clientApiKey: options.clientApiKey,
        },
        browserTransport(options.fetch, true),
      );
    } catch (error) {
      client = undefined;
      throw error;
    }
  }

  async function deliver(payload: AnalyticsEvent): Promise<void> {
    try {
      client ??= connect();
      const api = await client;
      if (options.enabled()) {
        await api.sendAnalyticsEvent({ payload });
      }
    } catch {
      // Analytics is best effort and never delays storefront actions.
    }
  }

  async function finishDelivery(work: Promise<void>): Promise<void> {
    await work;
    inFlight.delete(work);
  }

  async function releaseClient(): Promise<void> {
    await Promise.allSettled(inFlight);
    try {
      const api = await client;
      api?.uniffiDestroy();
    } catch {
      // Initialization may have failed before there was a client to release.
    }
  }

  function send(event: () => AnalyticsEvent): void {
    if (disposed || !options.enabled()) {
      return;
    }
    const work = deliver(event());
    inFlight.add(work);
    void finishDelivery(work);
  }

  function observe(subscribe: (listener: (event: TryOnExperienceEvent) => void) => () => void) {
    return subscribe((event) => {
      const { detail } = event;
      const data = common(detail.productId);
      const eventContext = browserContext();
      function operationFailed(
        work: string,
        outcome: "failed" | "uncertain" | "detached",
        reason?: string,
      ) {
        send(
          () =>
            new AnalyticsEvent.ExperienceOperationFailed({
              event: {
                ...eventContext,
                data: {
                  ...data,
                  work,
                  outcome,
                  ...(reason !== undefined && { reason }),
                  currentStep: steps[detail.step],
                },
              },
            }),
        );
      }

      // oxlint-disable-next-line eslint/default-case -- Every experience event is covered.
      switch (event.type) {
        case "sv-try-on-opened": {
          if (event.detail.entry !== undefined) {
            const { entry, subentry } = event.detail;
            send(
              () =>
                new AnalyticsEvent.EntrypointClicked({
                  event: {
                    ...eventContext,
                    data: {
                      ...data,
                      entry,
                      ...(subentry !== undefined && { subentry }),
                      currentStep: steps[detail.step],
                    },
                  },
                }),
            );
          }
          break;
        }
        case "sv-try-on-step-changed": {
          const source =
            event.detail.previousStep === undefined
              ? new AnalyticsStep.Entry()
              : steps[event.detail.previousStep];
          if (detail.step === "intro") {
            send(
              () =>
                new AnalyticsEvent.IntroOpened({
                  event: { ...eventContext, data: { ...data, source } },
                }),
            );
          } else if (detail.step === "height") {
            send(
              () =>
                new AnalyticsEvent.HeightEntered({
                  event: { ...eventContext, data: { ...data, source } },
                }),
            );
          } else if (detail.step === "variant-selection") {
            send(
              () =>
                new AnalyticsEvent.VariantSelectionInitiated({
                  event: { ...eventContext, data: { ...data, source } },
                }),
            );
          }
          break;
        }
        case "sv-try-on-consent-granted": {
          send(() => new AnalyticsEvent.ConsentGranted({ event: { ...eventContext, data } }));
          break;
        }
        case "sv-try-on-photo-source-started": {
          const source = imageSource(event.detail.originStep);
          const info = { ...eventContext, data: { ...data, source } };
          send(() =>
            event.detail.source === "camera"
              ? new AnalyticsEvent.ImageRecordInitiated({ event: info })
              : new AnalyticsEvent.ImageUploadInitiated({ event: info }),
          );
          break;
        }
        case "sv-try-on-photo-source-cancelled": {
          const source = imageSource(event.detail.originStep);
          const info = { ...eventContext, data: { ...data, source } };
          send(() =>
            event.detail.source === "camera"
              ? new AnalyticsEvent.ImageRecordAborted({ event: info })
              : new AnalyticsEvent.ImageUploadAborted({ event: info }),
          );
          break;
        }
        case "sv-try-on-photo-processing": {
          break;
        }
        case "sv-try-on-photo-accepted": {
          send(
            () =>
              new AnalyticsEvent.ImageUploaded({
                event: {
                  ...eventContext,
                  data: {
                    ...data,
                    imageSource:
                      event.detail.source === "camera"
                        ? new ImageUploadedDataImageSource.RecordSelfTimer()
                        : new ImageUploadedDataImageSource.Select(),
                  },
                },
              }),
          );
          break;
        }
        case "sv-try-on-requested": {
          send(
            () =>
              new AnalyticsEvent.TryOnInitiated({
                event: { ...eventContext, data: variantData(event.detail) },
              }),
          );
          break;
        }
        case "sv-try-on-closed": {
          send(
            () =>
              new AnalyticsEvent.ViewClosed({
                event: { ...eventContext, data: { ...data, currentStep: steps[detail.step] } },
              }),
          );
          break;
        }
        case "sv-try-on-session-failed": {
          operationFailed("session", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-height-failed": {
          operationFailed("height", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-operation-uncertain": {
          operationFailed(event.detail.work, "uncertain");
          break;
        }
        case "sv-try-on-camera-failed": {
          operationFailed("camera", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-capture-failed": {
          operationFailed("capture", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-picker-failed": {
          operationFailed("picker", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-photo-failed": {
          operationFailed("photo", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-failed": {
          operationFailed("try-on", "failed", event.detail.reason);
          break;
        }
        case "sv-try-on-detached": {
          operationFailed("try-on", "detached", event.detail.stage);
          break;
        }
        case "sv-try-on-add-to-cart-requested":
        case "sv-try-on-height-confirmed":
        case "sv-try-on-photo-rejected":
        case "sv-try-on-presented":
        case "sv-try-on-refused":
        case "sv-try-on-rendered":
        case "sv-try-on-request-resolved":
        case "sv-try-on-variant-changed": {
          break;
        }
      }
    });
  }

  return {
    observe,
    entrypointImpression(productId: string, entry: string) {
      send(
        () =>
          new AnalyticsEvent.EntrypointImpression({
            event: { ...browserContext(), data: { ...common(productId), entry } },
          }),
      );
    },
    cartItemAdded(event: CommerceAnalyticsEvent) {
      send(
        () =>
          new AnalyticsEvent.CartItemAdded({
            event: { ...browserContext(), data: variantData(event) },
          }),
      );
    },
    orderPlaced(event: CommerceAnalyticsEvent) {
      send(
        () =>
          new AnalyticsEvent.OrderPlaced({
            event: { ...browserContext(), data: variantData(event) },
          }),
      );
    },
    experimentAssigned(enabled: boolean) {
      send(
        () =>
          new AnalyticsEvent.ExperimentAssigned({
            event: {
              ...browserContext(),
              data: {
                sdkVersion,
                variant: enabled
                  ? new ExperimentAssignedDataVariant.Enabled()
                  : new ExperimentAssignedDataVariant.Disabled(),
              },
            },
          }),
      );
    },
    dispose() {
      disposed = true;
      void releaseClient();
    },
  };
}

export interface TryOnAnalytics {
  observe: (
    subscribe: (listener: (event: TryOnExperienceEvent) => void) => () => void,
  ) => () => void;
  entrypointImpression: (productId: string, entry: string) => void;
  cartItemAdded: (event: CommerceAnalyticsEvent) => void;
  orderPlaced: (event: CommerceAnalyticsEvent) => void;
  experimentAssigned: (enabled: boolean) => void;
  dispose: () => void;
}
