import type { TryOnFlowProduct, TryOnProductColorwayOption } from "./context/index.js";

/**
 * Resolves the colorway option for `selection["colorway"]` (the shop's id), falling back to the
 * first option when the id is unset or doesn't match. Returns `undefined` when the product
 * has no colorway-bearing variants (`attributeMetadata.colorways` is empty).
 */
export function tryOnColorwayOptionForAttribute(
  product: TryOnFlowProduct,
  colorwayId: string | undefined,
): TryOnProductColorwayOption | undefined {
  const { colorways } = product.attributeMetadata;
  if (colorways.length === 0) {
    return undefined;
  }
  const first = colorways[0];
  if (first === undefined) {
    return undefined;
  }
  if (colorwayId === undefined || colorwayId.length === 0) {
    return first;
  }
  return colorways.find((c) => c.slug === colorwayId) ?? first;
}

/**
 * Display label for the current size attribute (lookup by size key). Falls back to the
 * first listed size's label when the key is unset or doesn't match. Returns
 * `undefined` when the product has no size-bearing variants
 * (`attributeMetadata.sizes` is empty).
 */
export function tryOnSizeLabelForAttribute(
  product: TryOnFlowProduct,
  sizeSlug: string | undefined,
): string | undefined {
  const { sizes } = product.attributeMetadata;
  const first = sizes[0];
  if (first === undefined) {
    return undefined;
  }
  if (sizeSlug === undefined || sizeSlug.length === 0) {
    return first.label;
  }
  return (sizes.find((s) => s.slug === sizeSlug) ?? first).label;
}
