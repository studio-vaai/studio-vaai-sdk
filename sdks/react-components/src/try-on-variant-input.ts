import type { TryOnFlowProduct, VariantAttributes } from "@studio-vaai/js-machine";

import { findVariantByAttributes, variantForeignIds } from "@studio-vaai/js-machine";

/**
 * Product + carousel-visible variant from the try-on result view: what a shop needs to add it to
 * its cart.
 */
export interface StudioVaaiTryOnVariantInput {
  product: TryOnFlowProduct;
  /** The selection: `{ colorway, size, template? }`, with `size` the size key (`27 / 30`). */
  attributes: VariantAttributes;
  /** `id` of the matched variant. Absent only when the product no longer sells these attributes. */
  variantId?: string;
  /** The shop's own id for the matched variant (its variant id or SKU), when it names one. */
  foreignId?: string;
  /** The variant on every axis in the shop's own ids: `{ colorway, size, style?, template? }`. */
  foreignVariantIds: VariantAttributes;
}

/** The host's view of `attributes` on `product`. */
export function tryOnVariantInput(
  product: TryOnFlowProduct,
  attributes: VariantAttributes,
): StudioVaaiTryOnVariantInput {
  const variant = findVariantByAttributes(product, attributes);
  const variantId = variant?.id;
  const foreignId = variant?.foreignId;
  return {
    product,
    attributes,
    ...(variantId === undefined ? {} : { variantId }),
    ...(foreignId === undefined ? {} : { foreignId }),
    foreignVariantIds: variantForeignIds(product, attributes),
  };
}
