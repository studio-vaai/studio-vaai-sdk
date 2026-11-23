import type { TryOnExperienceEvent, TryOnExperienceStep } from "../experience/events.js";

export interface AnalyticsOptions {
  clientApiKey: string;
  /** Compatibility option. Cookieless analytics does not attach an SDK version. */
  sdkVersion?: string;
  baseUrl?: string;
  /** The storefront can turn collection on or off over the lifetime of the widget. */
  enabled: () => boolean;
  /** Compatibility option. Analytics no longer reads or sends visitor IDs. */
  visitorId?: () => string;
  fetch?: typeof fetch;
}

let visitor: { day: string; id: string } | undefined;

/** @deprecated This helper is no longer used by analytics. */
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
  intro: "intro",
  camera: "image-record",
  "photo-upload": "image-upload",
  "photo-rejected": "image-rejection",
  height: "height",
  "variant-selection": "variant-selection",
  "try-on": "try-on",
} as const;

function imageSource(step: TryOnExperienceStep): string {
  if (step === "height" || step === "variant-selection") {
    return step;
  }
  if (step === "try-on") {
    return "variant-selection";
  }
  return step === "photo-rejected" ? "image-rejection" : "intro";
}

const axes = ["size", "colorway", "waist", "length"] as const;
const limit = 32;

type EventData = Record<string, string | number | boolean>;

export interface CommerceAnalyticsEvent {
  productId: string;
  variantId?: string;
  foreignIds: Readonly<Record<string, string>>;
}

function variantData({ productId, variantId, foreignIds }: CommerceAnalyticsEvent): EventData {
  const data: EventData = { "product-id": productId };
  if (variantId === undefined) {
    // The older host callback only carries catalog axes.
    for (const axis of axes) {
      const value = foreignIds[axis];
      if (value !== undefined) {
        data[`variant-${axis}`] = value;
      }
    }
  } else {
    data["variant-id"] = variantId;
  }
  return data;
}

function timeBucket(seconds: number): string {
  if (seconds < 10) {
    return "lt-10s";
  }
  if (seconds < 30) {
    return "10-29s";
  }
  if (seconds < 60) {
    return "30-59s";
  }
  return seconds < 120 ? "60-119s" : "120s-plus";
}

function startSummary(productId: string, entry?: string) {
  return {
    productId,
    entry,
    startedAt: performance.now(),
    intro: false,
    consent: false,
    photo: false,
    height: false,
    selection: false,
    requested: false,
    cart: false,
    timeToResult: undefined as string | undefined,
    missingVariant: false,
    variants: new Map<string, Readonly<Record<string, string>>>(),
    displayed: new Set<string>(),
    axes: {
      size: new Set<string>(),
      colorway: new Set<string>(),
      waist: new Set<string>(),
      length: new Set<string>(),
    },
  };
}

/** Counts lifecycle facts without sending a shopper identity or reading browser context. */
export function createTryOnAnalytics(options: AnalyticsOptions): TryOnAnalytics {
  let disposed = false;
  const endpoint = `${(options.baseUrl ?? "https://a.studio-vaai.com").replace(/\/$/u, "")}/v2/events`;

  async function deliver(name: string, data: EventData): Promise<void> {
    try {
      const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
      await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Api-Key": options.clientApiKey },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        keepalive: true,
        body: JSON.stringify({ eventId: crypto.randomUUID(), event: { name, data } }),
      });
    } catch {
      // Analytics is best effort, including in environments without fetch or Web Crypto.
    }
  }

  function send(name: string, data: EventData): void {
    if (!disposed && options.enabled()) {
      void deliver(name, data);
    }
  }

  function observe(subscribe: (listener: (event: TryOnExperienceEvent) => void) => () => void) {
    let summary: ReturnType<typeof startSummary> | undefined;
    const shopperRequests = new Map<string, string>();
    return subscribe((event) => {
      if (disposed || !options.enabled()) {
        summary = undefined;
        shopperRequests.clear();
        return;
      }
      const { detail } = event;
      const { productId } = detail;
      const data = { "product-id": productId };
      if (
        summary !== undefined &&
        summary.productId !== productId &&
        (event.type === "sv-try-on-step-changed" ||
          event.type === "sv-try-on-variant-changed" ||
          event.type === "sv-try-on-presented")
      ) {
        summary = startSummary(productId, summary.entry);
      }
      const scope = summary?.productId === productId ? summary : undefined;
      const step = steps[detail.step];
      function operationStatus(work: string, outcome: string, reason?: "slow" | "deadline") {
        send("experience-operation-failed", {
          ...data,
          work,
          outcome,
          "current-step": step,
          ...(reason === undefined ? {} : { reason }),
        });
      }

      // oxlint-disable-next-line eslint/default-case -- The lifecycle event union is exhaustive.
      switch (event.type) {
        case "sv-try-on-opened": {
          const { entry } = event.detail;
          shopperRequests.clear();
          summary = startSummary(productId, entry);
          summary.intro = detail.step === "intro";
          summary.selection = detail.step === "variant-selection";
          const withEntry = entry === undefined ? data : { ...data, entry };
          send("widget-opened", withEntry);
          if (entry !== undefined) {
            send("entrypoint-clicked", withEntry);
          }
          break;
        }
        case "sv-try-on-step-changed": {
          const source =
            event.detail.previousStep === undefined ? "entry" : steps[event.detail.previousStep];
          if (detail.step === "intro") {
            if (scope !== undefined) {
              scope.intro = true;
            }
            send("intro-opened", { ...data, source });
          } else if (detail.step === "height") {
            send("height-step-opened", { ...data, source });
          } else if (detail.step === "variant-selection") {
            if (scope !== undefined) {
              scope.selection = true;
            }
            send("variant-selection-initiated", { ...data, source });
          }
          break;
        }
        case "sv-try-on-consent-granted": {
          if (scope !== undefined) {
            scope.consent = true;
          }
          send("consent-granted", data);
          break;
        }
        case "sv-try-on-photo-source-started":
        case "sv-try-on-photo-source-cancelled": {
          const started = event.type === "sv-try-on-photo-source-started";
          const family = event.detail.source === "camera" ? "image-record" : "image-upload";
          send(`${family}-${started ? "initiated" : "aborted"}`, {
            ...data,
            source: imageSource(event.detail.originStep),
          });
          break;
        }
        case "sv-try-on-photo-accepted": {
          if (scope !== undefined) {
            scope.photo = true;
          }
          send("image-uploaded", {
            ...data,
            "image-source": event.detail.source === "camera" ? "record-self-timer" : "select",
          });
          break;
        }
        case "sv-try-on-photo-rejected": {
          send("photo-rejected", {
            ...data,
            method: event.detail.source === "camera" ? "camera" : "picker",
          });
          break;
        }
        case "sv-try-on-height-confirmed": {
          if (scope !== undefined) {
            scope.height = true;
          }
          send("height-entered", data);
          break;
        }
        case "sv-try-on-variant-changed": {
          if (
            scope !== undefined &&
            (scope.variants.size < limit || scope.variants.has(event.detail.variantId))
          ) {
            scope.variants.set(event.detail.variantId, event.detail.foreignIds);
          }
          send("variant-changed", variantData(event.detail));
          break;
        }
        case "sv-try-on-requested": {
          if (scope !== undefined) {
            scope.requested = true;
            if (scope.variants.size < limit || scope.variants.has(event.detail.variantId)) {
              scope.variants.set(event.detail.variantId, event.detail.foreignIds);
            }
          }
          if (event.detail.origin === "shopper") {
            if (shopperRequests.size >= limit) {
              const oldest = shopperRequests.keys().next().value;
              if (oldest !== undefined) {
                shopperRequests.delete(oldest);
              }
            }
            shopperRequests.set(event.detail.requestId, productId);
          }
          send("try-on-initiated", { ...variantData(event.detail), origin: event.detail.origin });
          break;
        }
        case "sv-try-on-presented": {
          const { tryOnId, variantId } = event.detail;
          if (scope?.displayed.has(tryOnId) === true) {
            break;
          }
          if (scope !== undefined) {
            scope.displayed.add(tryOnId);
            scope.timeToResult ??= timeBucket((performance.now() - scope.startedAt) / 1000);
            const selected = scope.variants.get(variantId);
            scope.missingVariant ||= selected === undefined;
            for (const axis of axes) {
              const value = selected?.[axis];
              if (value !== undefined && scope.axes[axis].size < limit) {
                scope.axes[axis].add(value);
              }
            }
          }
          send("try-on-presented", { ...data, "variant-id": variantId });
          break;
        }
        case "sv-try-on-closed": {
          send("view-closed", {
            ...data,
            "current-step": step,
            "result-displayed": event.detail.displayed !== undefined,
          });
          if (scope !== undefined) {
            send("experience-summary", {
              ...data,
              ...(scope.entry === undefined ? {} : { entry: scope.entry }),
              "reached-intro": scope.intro,
              "granted-consent": scope.consent,
              "accepted-photo": scope.photo,
              "confirmed-height": scope.height,
              "reached-selection": scope.selection,
              "requested-try-on": scope.requested,
              "presented-result": scope.displayed.size > 0,
              "requested-cart": scope.cart,
              "try-on-count": Math.min(limit, scope.displayed.size),
              ...(scope.missingVariant
                ? {}
                : {
                    "distinct-sizes": scope.axes.size.size,
                    "distinct-colors": scope.axes.colorway.size,
                    "distinct-waists": scope.axes.waist.size,
                    "distinct-lengths": scope.axes.length.size,
                  }),
              ...(scope.timeToResult === undefined ? {} : { "time-to-result": scope.timeToResult }),
            });
          }
          summary = undefined;
          shopperRequests.clear();
          break;
        }
        case "sv-try-on-add-to-cart-requested": {
          if (scope !== undefined) {
            scope.cart = true;
          }
          send("cart-requested", variantData(event.detail));
          break;
        }
        case "sv-try-on-session-failed": {
          operationStatus("session", "failed");
          break;
        }
        case "sv-try-on-height-failed": {
          operationStatus("height", "failed");
          break;
        }
        case "sv-try-on-operation-uncertain": {
          operationStatus(event.detail.work, "uncertain");
          break;
        }
        case "sv-try-on-operation-slow": {
          operationStatus(event.detail.work, "in_progress", "slow");
          break;
        }
        case "sv-try-on-operation-deadline": {
          operationStatus(event.detail.work, "failed", "deadline");
          break;
        }
        case "sv-try-on-camera-failed": {
          operationStatus("camera", "failed");
          break;
        }
        case "sv-try-on-capture-failed": {
          operationStatus("capture", "failed");
          break;
        }
        case "sv-try-on-picker-failed": {
          operationStatus("picker", "failed");
          break;
        }
        case "sv-try-on-photo-failed": {
          operationStatus("photo", "failed");
          break;
        }
        case "sv-try-on-failed": {
          shopperRequests.delete(event.detail.requestId);
          operationStatus("try-on", "failed");
          break;
        }
        case "sv-try-on-detached": {
          shopperRequests.delete(event.detail.requestId);
          operationStatus("try-on", "detached");
          break;
        }
        case "sv-try-on-refused": {
          if (shopperRequests.get(event.detail.requestId) === productId) {
            send("gated-size-selected", data);
          }
          shopperRequests.delete(event.detail.requestId);
          break;
        }
        case "sv-try-on-request-resolved": {
          shopperRequests.delete(event.detail.requestId);
          break;
        }
        case "sv-try-on-photo-processing":
        case "sv-try-on-rendered": {
          break;
        }
      }
    });
  }

  return {
    observe,
    entrypointImpression(productId, entry) {
      send("entrypoint-impression", { "product-id": productId, entry });
    },
    cartItemAdded(event) {
      send("cart-item-added", variantData(event));
    },
    orderPlaced(event) {
      send("order-placed", variantData(event));
    },
    experimentAssigned(enabled) {
      send("experiment-assigned", {
        experiment: "try-on-enabled",
        variant: enabled ? "enabled" : "disabled",
      });
    },
    dispose() {
      disposed = true;
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
