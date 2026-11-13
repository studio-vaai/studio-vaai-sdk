import type { ProductId } from "@studio-vaai/js-client";

import { sizeKeyOf } from "@studio-vaai/js-client";

import type {
  TryOnFlowProduct,
  TryOnFlowProductVariant,
  TryOnProductColorwayOption,
  TryOnProductSizeOption,
  TryOnProductStyleGlyph,
  TryOnProductStyleOption,
  TryOnProductVariantAxis,
} from "./context/index.js";

import { STYLE_ATTRIBUTE_KEY } from "./context/index.js";

const COLORWAY_AXIS_KEY = "colorway";

/** Swatch colour of a colorway that only has an image, shown while the image loads or if it fails. */
const FALLBACK_SWATCH_HEX = "#d4d4d8";

/** One value of a {@link ProductAxis}: the shop's id for it, and how the shop shows it. */
export interface ProductAxisItem {
  /** The shop's id; matches variants' `foreignVariantIds`. */
  key: string;
  display: {
    text?: string;
    image?: string;
    alt?: string;
    hex?: string;
    swatchRing?: boolean;
    glyph?: TryOnProductStyleGlyph;
  };
  /** Listed but out of stock. Marks a size, and on several axes every combination it is part of. */
  soldOut?: boolean;
}

/** One way the shop sells a product. Its position among the axes and its items' order are the display order. */
export interface ProductAxis {
  /** `colorway`, `size`, `style`, `template`: the key in variants' `foreignVariantIds`. */
  key: string;
  /** The shop's own label. */
  label: string | null;
  items: readonly ProductAxisItem[];
}

export interface BuildTryOnFlowProductInput {
  productId: ProductId;
  displayName: string;
  axes: readonly ProductAxis[];
  /** `ProductDetails.variants`. */
  variants: readonly {
    id: string;
    foreignVariantIds: Readonly<Record<string, string>>;
    foreignId?: string;
  }[];
  productThumbnailUrl?: string;
  priceLabel?: string;
}

function itemText(item: ProductAxisItem): string {
  return item.display.text ?? item.display.alt ?? item.key;
}

function colorwayOption({ key, display }: ProductAxisItem): TryOnProductColorwayOption {
  return {
    slug: key,
    label: itemText({ key, display }),
    hex: display.hex ?? FALLBACK_SWATCH_HEX,
    ...(display.swatchRing === undefined ? {} : { swatchRing: display.swatchRing }),
    ...(display.image === undefined ? {} : { imageUrl: display.image }),
  };
}

function styleOption({ key, display }: ProductAxisItem): TryOnProductStyleOption {
  return {
    slug: key,
    label: itemText({ key, display }),
    ...(display.glyph === undefined ? {} : { glyph: display.glyph }),
    ...(display.image === undefined ? {} : { iconUrl: display.image }),
  };
}

function variantAxis({ key, label, items }: ProductAxis): TryOnProductVariantAxis {
  return {
    key,
    label: label ?? key,
    values: items.map((item) => ({ slug: item.key, label: itemText(item) })),
  };
}

/** One size per item of the product's only size axis, whether or not a variant has it. */
function singleAxisSizes(axis: ProductAxis | undefined): TryOnProductSizeOption[] {
  return (axis?.items ?? []).map((item) => ({
    slug: item.key,
    label: itemText(item),
    ...(item.soldOut === true ? { soldOut: true } : {}),
  }));
}

/**
 * One size per combination of the axes' items that a variant sells, first axis slowest, so the
 * host's order carries through. A combination no variant sells has no size: the pickers grey it.
 */
function multiAxisSizes(
  axes: readonly ProductAxis[],
  sizeKeys: ReadonlySet<string>,
): TryOnProductSizeOption[] {
  let combinations: readonly (readonly { axis: string; item: ProductAxisItem }[])[] = [[]];
  for (const axis of axes) {
    combinations = combinations.flatMap((combination) =>
      axis.items.map((item) => [...combination, { axis: axis.key, item }]),
    );
  }
  return combinations.flatMap((combination) => {
    const options = Object.fromEntries(combination.map(({ axis, item }) => [axis, item.key]));
    const slug = sizeKeyOf(options);
    if (!sizeKeys.has(slug)) {
      return [];
    }
    return [
      {
        slug,
        label: combination.map(({ item }) => itemText(item)).join(" / "),
        options,
        ...(combination.some(({ item }) => item.soldOut === true) ? { soldOut: true } : {}),
      },
    ];
  });
}

/**
 * The try-on product of a shop's own merchandising (`axes`, in display order) and the API's
 * `variants`, joined on the shop's ids. The API has no labels, images, ordering or prices; the
 * host's axes are where those come from.
 *
 * A variant's `attributes` are `{ colorway?, template?, size }`, with `size` its
 * {@link sizeKeyOf size key}, so a waist × length product selects `size: "27 / 30"` and each
 * `attributeMetadata.sizes[]` entry names its value per axis in `options`.
 */
export function buildTryOnFlowProduct({
  productId,
  displayName,
  axes,
  variants,
  productThumbnailUrl,
  priceLabel,
}: BuildTryOnFlowProductInput): TryOnFlowProduct {
  const styles = axes
    .find((axis) => axis.key === STYLE_ATTRIBUTE_KEY)
    ?.items.map((item) => styleOption(item));
  const sizeAxes = axes.filter(
    (axis) => axis.key !== COLORWAY_AXIS_KEY && axis.key !== STYLE_ATTRIBUTE_KEY,
  );
  const flowVariants = variants.map(
    ({ id, foreignVariantIds: foreignIds, foreignId }): TryOnFlowProductVariant => {
      const colorway = foreignIds[COLORWAY_AXIS_KEY];
      const template = foreignIds[STYLE_ATTRIBUTE_KEY];
      return {
        id,
        attributes: {
          ...(colorway === undefined ? {} : { [COLORWAY_AXIS_KEY]: colorway }),
          ...(template === undefined ? {} : { [STYLE_ATTRIBUTE_KEY]: template }),
          size: sizeKeyOf(foreignIds),
        },
        ...(foreignId === undefined ? {} : { foreignId }),
      };
    },
  );
  const severalAxes = sizeAxes.length > 1;
  const sizeKeys = new Set(variants.map(({ foreignVariantIds }) => sizeKeyOf(foreignVariantIds)));
  return {
    id: productId,
    displayName,
    variants: flowVariants,
    attributeMetadata: {
      colorways:
        axes
          .find((axis) => axis.key === COLORWAY_AXIS_KEY)
          ?.items.map((item) => colorwayOption(item)) ?? [],
      sizes: severalAxes ? multiAxisSizes(sizeAxes, sizeKeys) : singleAxisSizes(sizeAxes[0]),
      ...(styles === undefined || styles.length === 0 ? {} : { styles }),
      ...(severalAxes ? { variantAxes: sizeAxes.map((axis) => variantAxis(axis)) } : {}),
    },
    ...(productThumbnailUrl === undefined ? {} : { productThumbnailUrl }),
    ...(priceLabel === undefined ? {} : { priceLabel }),
  };
}
