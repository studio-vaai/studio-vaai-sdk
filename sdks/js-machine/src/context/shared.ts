import type { BodyValidationCode, ProductId, StandardError } from "@studio-vaai/js-client";
import type { BodyId } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

/**
 * Host-supplied attribute picks describing what the user has selected so far, in the shop's own
 * ids: `{ colorway: "A100-259", size: "M" }`, plus `template` on a multi-template product. `size`
 * is the size key (`sizeKeyOf` from `@studio-vaai/js-client`), so a waist × length pick reads
 * `size: "27 / 30"`. Partial maps (e.g. only `{ colorway }`) are valid — the machine gates try-on
 * on {@link findVariantByAttributes} matching the picked map. An empty map means "nothing picked
 * yet"; a full map that doesn't match any {@link TryOnFlowProductVariant} is treated identically
 * to a partial map (try-on stays disabled).
 */
export type VariantAttributes = Readonly<Record<string, string>>;

/**
 * Single colorway swatch for the try-on product UI. `slug` is the shop's colorway id, carried in
 * `variants[].attributes.colorway` and in {@link VariantAttributes}; `label` is the display
 * string (e.g. "Espresso" for id "A100-259").
 */
export interface TryOnProductColorwayOption {
  slug: string;
  label: string;
  hex: string;
  /** When true, swatch shows a subtle ring (e.g. light colors on a light sheet). */
  swatchRing?: boolean;
  /**
   * Fabric/pattern image rendered INSIDE the swatch circle instead of the flat `hex` fill —
   * for colorways a single color cannot represent (stripes, prints). `hex` stays as the
   * fallback while the image loads or when it fails.
   */
  imageUrl?: string;
}

/**
 * Single size chip. `slug` is the size key carried in `variants[].attributes.size` and in
 * {@link VariantAttributes}; `label` is the display string (e.g. "Medium" for size key "M").
 */
export interface TryOnProductSizeOption {
  slug: string;
  label: string;
  /**
   * The brand lists this size but has no stock for it. It still renders in the picker —
   * hiding it would make the run look incomplete and hide the fact that the recommended
   * size is the one that's gone — but it can't be picked, and selecting it explains why.
   * Distinct from the try-on gate, which is about this body rather than the warehouse.
   */
  soldOut?: boolean;
  /**
   * Products sold along several axes only ({@link TryOnFlowProductAttributeMetadata.variantAxes}):
   * this size's shop id on every axis (`{ size: "27", style: "30" }`). Such a size is one
   * published combination, and its `slug` is the combination's size key (`27 / 30`).
   */
  options?: Readonly<Record<string, string>>;
}

/** One value of a {@link TryOnProductVariantAxis}. */
export interface TryOnProductVariantAxisValue {
  /** The shop's id for this value: what {@link TryOnProductSizeOption.options} names on this axis. */
  slug: string;
  /** Display label (`27`, `30`). */
  label: string;
}

/**
 * One axis a product is sold along: `Waist` (key `size`) and `Length` for jeans. The host's axis
 * and value order is the display order.
 */
export interface TryOnProductVariantAxis {
  /** `size` for the axis the size chart ranks, then e.g. `style`: the key in variants' `foreignVariantIds`. */
  key: string;
  /** Display label (`Waist`, `Length`). */
  label: string;
  /** Values in display order. */
  values: readonly TryOnProductVariantAxisValue[];
}

/**
 * One variant the API can try on. `id` is what `createTryOn` takes (`ProductDetails.variants[].id`);
 * `attributes` is the variant's selection in the shop's ids (see {@link VariantAttributes}).
 *
 * The SDK looks up the active variant by deep-equal on `attributes`, so every key
 * the host renders as a picker (colorway / size) must appear on every variant.
 */
export interface TryOnFlowProductVariant {
  id: string;
  attributes: Readonly<Record<string, string>>;
  /** The shop's own id for this combination (its variant id or SKU), when it names one. */
  foreignId?: string;
}

/**
 * Per-attribute UI metadata: rendering chrome (hex/label/swatchRing for colorways) and the
 * authoritative display order (sizes are bare strings; their order in the array is what
 * the picker uses). Each dimension may be empty when the product has no variants on
 * that axis — UIs hide the corresponding picker in that case.
 */
export interface TryOnFlowProductAttributeMetadata {
  colorways: readonly TryOnProductColorwayOption[];
  sizes: readonly TryOnProductSizeOption[];
  /**
   * Styles of one garment that share every size and colour but are cut differently — a
   * blazer sold buttoned up or buttoned down. Each style is a *template*, the shop's id for it
   * carried in `variants[].attributes.template` and in {@link VariantAttributes} under
   * {@link STYLE_ATTRIBUTE_KEY}. Omitted or empty for single-style products, which then
   * never send the key. When present, a try-on renders EVERY style of the picked size and
   * colour at once (see `tryOnCompanions`), so flipping the style in the result view is
   * instant.
   */
  styles?: readonly TryOnProductStyleOption[];
  /**
   * Present for a product sold along several axes (waist × length). `sizes` then lists one entry
   * per published combination, each with its {@link TryOnProductSizeOption.options}; the pickers
   * show one row per axis and grey out the combinations no size names. Absent (or with fewer
   * than two axes) the product is sold by size alone and renders exactly as before.
   */
  variantAxes?: readonly TryOnProductVariantAxis[];
}

/** Attribute key a style rides under: the shop's id for the template. */
export const STYLE_ATTRIBUTE_KEY = "template";

/**
 * Built-in style glyphs the SDK can draw without host assets. Hosts with other styles
 * pass {@link TryOnProductStyleOption.iconUrl} instead.
 */
export type TryOnProductStyleGlyph = "buttoned-up" | "buttoned-down";

/**
 * One style chip. `slug` is the shop's template id carried in
 * `variants[].attributes.template`; `label` is the display string ("Buttoned up").
 * Exactly one of `glyph` / `iconUrl` gives the chip its picture; with neither the chip
 * is text-only.
 */
export interface TryOnProductStyleOption {
  slug: string;
  label: string;
  /** A glyph the SDK ships (drawn in `currentColor`, matches the rest of the icon set). */
  glyph?: TryOnProductStyleGlyph;
  /** Host-supplied icon (SVG/PNG URL) rendered at chip size when no built-in glyph fits. */
  iconUrl?: string;
}

/**
 * The selections a try-on for `selection` should render alongside it: one per OTHER
 * style, same size and colour, limited to combinations the product actually offers.
 * Empty for single-style products or when the selection names no style.
 */
export function companionStyleSelections(
  product: TryOnFlowProduct,
  selection: VariantAttributes,
): VariantAttributes[] {
  const styles = product.attributeMetadata.styles ?? [];
  const current = selection[STYLE_ATTRIBUTE_KEY];
  if (styles.length < 2 || current === undefined) {
    return [];
  }
  return styles
    .filter((style) => style.slug !== current)
    .map((style) => ({ ...selection, [STYLE_ATTRIBUTE_KEY]: style.slug }))
    .filter((candidate) => findVariantByAttributes(product, candidate) !== undefined);
}

/**
 * Full try-on product: id, display chrome, the authoritative variant list, and per-attribute
 * UI metadata. Supplied with {@link DefaultRootInput} and kept in root context.
 *
 * `variants[]` is the source of truth for which (colorway, size) combinations the API
 * can try on. Build it with `buildTryOnFlowProduct` from `ProductDetails.variants`. `attributeMetadata` carries the swatch hex/label and the display order
 * for each attribute dimension — separated so adding a new attribute (e.g. material,
 * fit) is a localized change.
 */
export interface TryOnFlowProduct {
  id: ProductId;
  displayName: string;
  variants: readonly TryOnFlowProductVariant[];
  attributeMetadata: TryOnFlowProductAttributeMetadata;
  /** URL for the small product thumbnail on the try-on result screen (e.g. garment still). */
  productThumbnailUrl?: string;
  /**
   * Fully formatted, localized price for the product as the host already renders it on the
   * PDP (e.g. `"€89"`, `"89,00 €"`). Shown in the try-on screen's add-to-bag link. The SDK
   * never formats or converts it: the host owns currency, locale, and tax display, and a
   * price the widget derived itself could disagree with the one a shopper sees behind it.
   * Omit to fall back to size-only copy.
   */
  priceLabel?: string;
}

/**
 * Find the variant matching `attributes` by deep-equal on the attribute map.
 * Returns `undefined` for partial / unknown selections — callers gate try-on
 * on the result being defined.
 */
export function findVariantByAttributes(
  product: TryOnFlowProduct,
  attributes: VariantAttributes,
): TryOnFlowProductVariant | undefined {
  const keys = Object.keys(attributes);
  return product.variants.find((v) => {
    const vKeys = Object.keys(v.attributes);
    if (vKeys.length !== keys.length) {
      return false;
    }
    return keys.every((k) => v.attributes[k] === attributes[k]);
  });
}

/** Injected into every machine via `input`. */
export interface JsMachineInput {
  client: StudioVaaiClient;
}

/**
 * Normalized sub-rect of an image, captured at the moment the source was
 * acquired (e.g. the camera composition bbox at shutter time). All four fields
 * are in `[0, 1]` against the image's natural dimensions; `cx` / `cy` is the
 * bbox center, `width` / `height` its size. Downstream display surfaces render
 * the source cropped to this rect so the stored Blob/File can keep the
 * original full frame without baking the crop in. Absent on user-picked files
 * where there was no composition lock.
 */
export interface FrameLock {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * Compute the {@link FrameLock} a center-crop `object-cover` of `natural` to a
 * target aspect would have produced. Used at camera capture time: the live
 * preview shows the stream cropped via CSS `object-cover` to a fixed bbox; the
 * captured Blob is the full sensor frame, and this helper reconstructs the
 * bbox so downstream display can match what the user saw.
 */
export function frameLockFromCenterCrop(
  natural: { width: number; height: number },
  targetAspect: number,
): FrameLock {
  const blobAspect = natural.width / natural.height;
  if (blobAspect > targetAspect) {
    return { cx: 0.5, cy: 0.5, width: targetAspect / blobAspect, height: 1 };
  }
  return { cx: 0.5, cy: 0.5, width: 1, height: blobAspect / targetAspect };
}

/**
 * One body revision — what the body looked like at a confirmed-height moment.
 * Appended to {@link DefaultRootContext.bodyRevisions} on every `CALIBRATION_DONE`
 * whose height differs from the last (re-confirming the same height is a
 * no-op). Try-on history entries snapshot the index of the active revision at
 * append time (see {@link TryOnHistoryEntry.bodyRevisionIndex}) so the UI can
 * recover the height that produced each entry and flag entries generated
 * under an older body. Mirrors the server's `body_revisions` concept.
 */
export interface BodyRevision {
  /** Body ID at the time of this revision; carried for future attribution UIs. */
  bodyId: BodyId;
  /** Confirmed height (cm) at this revision. */
  bodyHeightCm: number;
}

/**
 * Error/rejection delivered to UI when a `createBody` flow could not complete.
 *
 * `validation` carries the typed server-side image rejection (UI should localize from `code`).
 * `StandardError` covers transport, auth, and system failures (HTTP 5xx).
 */
export type CreateBodyLikeError =
  | StandardError
  | {
      kind: "validation";
      code: BodyValidationCode;
      message: string;
      details?: unknown;
    };
