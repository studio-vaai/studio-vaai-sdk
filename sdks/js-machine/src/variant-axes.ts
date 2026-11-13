import type {
  TryOnFlowProduct,
  TryOnProductVariantAxis,
  VariantAttributes,
} from "./context/index.js";

/**
 * Helpers for a product sold along several axes (waist × length). Such a product lists one
 * size per published combination (`27 / 30`) and names its place on every axis in
 * `options` (`{ size: "27", style: "30" }`). The selection keeps carrying the combination's
 * size key, so the gate, the recommendation and the try-on history stay keyed exactly as on a
 * single-axis product; the axes only change how the pickers draw it.
 */

/** The product's axes when it is sold along two or more; `undefined` for size-only products. */
export function productVariantAxes(
  product: TryOnFlowProduct,
): readonly TryOnProductVariantAxis[] | undefined {
  const axes = product.attributeMetadata.variantAxes;
  return axes !== undefined && axes.length > 1 ? axes : undefined;
}

/** The combination sold under the size key `sizeSlug`: its shop id on every axis. */
export function variantOptionsForSize(
  product: TryOnFlowProduct,
  sizeSlug: string | undefined,
): Readonly<Record<string, string>> | undefined {
  if (sizeSlug === undefined || sizeSlug.length === 0) {
    return undefined;
  }
  return product.attributeMetadata.sizes.find((size) => size.slug === sizeSlug)?.options;
}

/**
 * The size key of the combination with `valueSlug` on `axisKey` and, where it exists, the
 * current combination's values on every other axis. When that exact combination is not
 * published, the published one with `valueSlug` that sits closest to the current pick (fewest
 * steps along the other axes' display order) — so tapping a greyed length keeps the waist when
 * it can and moves it as little as possible when it cannot. `undefined` when no combination
 * has the value at all.
 */
export function variantCombinationFor(
  product: TryOnFlowProduct,
  currentSizeSlug: string | undefined,
  axisKey: string,
  valueSlug: string,
): string | undefined {
  const axes = productVariantAxes(product) ?? [];
  const current = variantOptionsForSize(product, currentSizeSlug) ?? {};
  let best: { slug: string; distance: number } | undefined;
  for (const size of product.attributeMetadata.sizes) {
    if (size.options?.[axisKey] !== valueSlug) {
      continue;
    }
    let distance = 0;
    for (const axis of axes) {
      if (axis.key === axisKey) {
        continue;
      }
      const want = current[axis.key];
      if (want === undefined) {
        continue;
      }
      const at = axis.values.findIndex((value) => value.slug === size.options?.[axis.key]);
      const wanted = axis.values.findIndex((value) => value.slug === want);
      distance += at === -1 || wanted === -1 ? axis.values.length : Math.abs(at - wanted);
    }
    if (best === undefined || distance < best.distance) {
      best = { slug: size.slug, distance };
    }
  }
  return best?.slug;
}

/**
 * Whether `valueSlug` on `axisKey` is published together with the current combination's
 * values on every other axis — the chip is drawn greyed when not. With nothing picked yet, any
 * combination carrying the value counts.
 */
export function variantValueAvailable(
  product: TryOnFlowProduct,
  currentSizeSlug: string | undefined,
  axisKey: string,
  valueSlug: string,
): boolean {
  const current = variantOptionsForSize(product, currentSizeSlug);
  return product.attributeMetadata.sizes.some((size) => {
    const options = size.options;
    if (options?.[axisKey] !== valueSlug) {
      return false;
    }
    if (current === undefined) {
      return true;
    }
    return Object.entries(current).every(
      ([key, value]) => key === axisKey || options[key] === value,
    );
  });
}

/**
 * `attributes` on every axis the product is sold by, in the shop's ids: what its variant carries
 * as `foreignVariantIds`, for adding it to the shop's cart. On a product sold along several axes the size
 * key expands to one entry per axis; everything else (colorway, template) stays as it is.
 */
export function variantForeignIds(
  product: TryOnFlowProduct,
  attributes: VariantAttributes,
): VariantAttributes {
  const options = variantOptionsForSize(product, attributes["size"]);
  if (options === undefined) {
    return attributes;
  }
  const { size: _size, ...rest } = attributes;
  return { ...rest, ...options };
}
