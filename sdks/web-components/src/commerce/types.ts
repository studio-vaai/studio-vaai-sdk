import type { AxisKey, ForeignId, VariantId } from "@studio-vaai/core";

/** Host-owned explanation of a refused stock choice. It never changes selection. */
export interface SvStockNotice {
  axis: AxisKey;
  item: ForeignId;
  variantId: VariantId;
}

/** Storefront-owned metadata for one VariantId. The SDK never computes price or stock. */
export interface SvVariantCommerce {
  /** Fully formatted by the host, including currency, locale and tax conventions. */
  price?: string | undefined;
  /** False refuses picker selection and cart requests for this variant; unknown stock stays host-owned. */
  inStock?: boolean | undefined;
}
