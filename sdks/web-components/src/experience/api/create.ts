import type { FlowConfig, InteractionToken } from "@studio-vaai/core";
import type { ClientConfig } from "@studio-vaai/core/api";

import { AutoStartPolicy } from "@studio-vaai/core";
import { ApiClient, browserTransport, initializeCore } from "@studio-vaai/core/api";

import type { TryOnExperienceDevices } from "./adapter.js";
import type { PresentProduct, ProductCommerce, TryOnProductReference } from "./product.js";

import { TryOnExperience, resolveCommerce } from "../controller.js";
import { apiAdapters } from "./adapter.js";
import { bodySelectionStore } from "./body-selection.js";
import { lookupProduct, productPresentationFor } from "./product.js";

export interface ApiTryOnExperienceOptions {
  api: ClientConfig;
  product: TryOnProductReference;
  /** Host identity and availability of the initial installation. */
  initialInstallation?: { token: InteractionToken; active: boolean };
  /** Supply the storefront’s display axes, starting selection, and initial commerce. */
  presentProduct: PresentProduct;
  /** Device resources for this experience, released when it is disposed. */
  devices: TryOnExperienceDevices;
  /** Storefront commerce overrides. A callback reads the latest data after catalogue lookup. */
  commerce?: ProductCommerce | (() => ProductCommerce | undefined);
  autoStart?: FlowConfig["autoStart"];
  /** Override browser fetch for API and signed upload requests. */
  fetch?: typeof fetch;
  /** Cancel setup while the catalogue is loading. */
  signal?: AbortSignal;
}

/** Keep configured fetch overrides subject to the same cancellation as browser fetch. */
function abortableFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal;
    if (signal === null || signal === undefined) {
      return await fetchImpl(input, init);
    }
    signal.throwIfAborted();
    const cancelled = Promise.withResolvers<Response>();
    const abort = () => {
      cancelled.reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await Promise.race([fetchImpl(input, init), cancelled.promise]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}

/** Fetch the product and wire the default Rust flow to the generated API client. */
export async function createApiTryOnExperience(
  options: ApiTryOnExperienceOptions,
): Promise<TryOnExperience> {
  const { signal } = options;
  let client: ApiClient | undefined;
  try {
    await initializeCore();
    signal?.throwIfAborted();
    const fetchImpl = abortableFetch(options.fetch ?? globalThis.fetch.bind(globalThis));
    client = new ApiClient(options.api, browserTransport(fetchImpl));
    const details = await lookupProduct(client, fetchImpl, options.product, signal);
    const { hostProduct, commerce } = productPresentationFor(details, (product) =>
      options.presentProduct(product),
    );
    const selection = await bodySelectionStore(options.api.baseUrl, options.api.clientApiKey);
    signal?.throwIfAborted();
    const overrides =
      typeof options.commerce === "function" ? options.commerce() : options.commerce;
    const snapshot = resolveCommerce(commerce, overrides);
    const adapters = apiAdapters(client, options.devices, fetchImpl, selection);
    return await TryOnExperience.create(
      { hostProduct, autoStart: options.autoStart ?? AutoStartPolicy.Never },
      adapters,
      details,
      {
        token: options.initialInstallation?.token ?? crypto.randomUUID(),
        active: options.initialInstallation?.active ?? true,
        unavailableVariants: snapshot.unavailableVariants,
        commerce: { initial: commerce, prices: snapshot.prices },
        ...("foreignId" in options.product && { foreignId: options.product.foreignId }),
      },
    );
  } catch (error) {
    try {
      options.devices.dispose();
    } finally {
      client?.uniffiDestroy();
    }
    throw error;
  }
}
