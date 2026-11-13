import type { HostProduct } from "@studio-vaai/core";
import type { ProductDetails } from "@studio-vaai/core/api";

import {
  ApiClient,
  ApiError,
  browserTransport,
  ExperienceProductLookup,
  experienceProductTimeoutMs,
  lookupExperienceProduct,
} from "@studio-vaai/core/api";

import type { SvVariantCommerce } from "../../commerce/types.js";

export type TryOnProductReference = { productId: string } | { foreignId: string };

/** Indicates that the catalog has no try-on product for the requested ID. */
export function isTryOnProductUnavailable(error: unknown): boolean {
  return (
    (error instanceof ApiError.Problem || error instanceof ApiError.UnexpectedStatus) &&
    error.inner.status === 404
  );
}

export type ProductCommerce = Readonly<Record<string, SvVariantCommerce>>;

export type ProductPresentation = Omit<HostProduct, "product"> & {
  /** Initial storefront prices and availability keyed by studio vaai variant ID. */
  commerce?: ProductCommerce;
};

export type PresentProduct = (details: ProductDetails) => ProductPresentation;

export async function lookupProduct(
  client: ApiClient,
  fetchImpl: typeof fetch,
  product: TryOnProductReference,
  signal?: AbortSignal,
): Promise<ProductDetails> {
  const timeout = AbortSignal.timeout(experienceProductTimeoutMs());
  const operation = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  operation.throwIfAborted();
  const scoped = client.withTransport(browserTransport(fetchImpl, false, operation));
  if (!ApiClient.instanceOf(scoped)) {
    throw new Error("The API did not return a scoped client.");
  }
  try {
    const lookup =
      "productId" in product
        ? new ExperienceProductLookup.Id(product)
        : new ExperienceProductLookup.ForeignId(product);
    const details = await lookupExperienceProduct(scoped, lookup);
    operation.throwIfAborted();
    return details;
  } finally {
    scoped.uniffiDestroy();
  }
}

export function productPresentationFor(details: ProductDetails, present: PresentProduct) {
  const { commerce, ...presentation } = present(details);
  const hostProduct: HostProduct = {
    ...presentation,
    product: {
      id: details.productId,
      variants: details.variants.map(({ id, foreignVariantIds }) => ({
        id,
        foreignIds: new Map(foreignVariantIds),
      })),
    },
  };
  const initialCommerce =
    commerce === undefined
      ? undefined
      : Object.fromEntries(Object.entries(commerce).map(([id, item]) => [id, { ...item }]));
  return { hostProduct, commerce: initialCommerce };
}
