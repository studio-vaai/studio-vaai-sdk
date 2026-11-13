import type { ApiResult, CallOptions } from "../base.js";
import type { ProductId } from "../types.js";

export interface GetProductDetailsArgs {
  productId: ProductId;
}

export interface GetProductByForeignIdArgs {
  /** The id your storefront uses for the product. */
  foreignId: string;
}

/** One sellable combination of a product. Pass its `id` to `createTryOn`. */
export interface ProductVariant {
  id: string;
  /**
   * This variant on every axis the product is sold by, in the shop's own ids:
   * `{ colorway: "A100-259", size: "XS" }`. Further axes are named by their key (`style`), and
   * `template` appears only on a product with several templates. See {@link sizeKeyOf}.
   */
  foreignVariantIds: Readonly<Record<string, string>>;
  /**
   * The shop's own id for this combination (its variant id or SKU), when the product names one:
   * what to add to the cart directly.
   */
  foreignId?: string;
}

/** One size of a {@link ListingProvenance}: the catalog piece and the stored drape it renders. */
export interface ListingSizeProvenance {
  /** The publication's size slug (`27-l30`, `s`), not the shop's id. */
  sizeSlug: string;
  /** The publication's style slug of the piece's template, not the shop's id. */
  templateSlug: string;
  pieceId: string;
  /** blake3 (hex) of the publication manifest the piece points at. */
  manifestHash?: string;
  /** The publication's size (realization) id the piece selects, decimal. */
  realizationId?: string;
  /** blake3 (hex) of the stored drape (executable drape object) this size renders. */
  bakeHash?: string;
}

/**
 * The library binding of one template (style) of a {@link ListingProvenance}: a product with
 * several templates binds each to its own library garment and promotes each on its own.
 */
export interface ListingTemplateProvenance {
  /** Style slug of the template ({@link ListingSizeProvenance.templateSlug}). */
  templateSlug: string;
  templateId: string;
  bindingId: string;
  /** Library garment slug. */
  garmentSlug: string;
  /** Number of the promoted library revision (`5` reads `r5`); absent before the first promotion. */
  revisionNumber?: number;
  revisionId?: string;
  /** First line of the promoted revision's commit message (at most 120 characters). */
  revisionMessage?: string;
  /** blake3 (hex) of the template's promoted publication manifest. */
  manifestHash?: string;
  /** Content hash (hex) of the listing the promotion applied. */
  listingHash?: string;
  /** RFC 3339. */
  promotedAt?: string;
}

/**
 * Where a listing came from: the library garment and revision, the publication and the stored
 * drape per size. Ids, hashes and timestamps only, never who pushed or promoted. A diagnostic, so
 * reviewers can check the shop serves exactly what Studio pushed and promoted.
 */
export interface ListingProvenance {
  productId: string;
  /**
   * Absent when no library binding sells the product (git-seeded fixtures). With several bound
   * templates, this and the binding, garment and revision fields are the first template's;
   * `templates` has each one's.
   */
  templateId?: string;
  bindingId?: string;
  /** Library garment slug. */
  garmentSlug?: string;
  /** Number of the promoted library revision (`5` reads `r5`). */
  revisionNumber?: number;
  revisionId?: string;
  /** First line of the promoted revision's commit message (at most 120 characters). */
  revisionMessage?: string;
  /** blake3 (hex) of the promoted publication manifest. */
  manifestHash?: string;
  /** Content hash (hex) of the listing the promotion applied. */
  listingHash?: string;
  /** RFC 3339. */
  promotedAt?: string;
  /** `int`, `prod`, `dev`. */
  environment?: string;
  /** API server build (image tag, a commit) that served the listing. */
  apiBuild?: string;
  /** Every published size, by rank. */
  sizes: ListingSizeProvenance[];
  /**
   * Every bound template's binding, garment and promoted revision, by template slug. A size
   * belongs to the template its `templateSlug` names. Absent when no binding sells the product.
   */
  templates?: ListingTemplateProvenance[];
}

/**
 * What the API knows about a product: its variants. Names, prices, photos, labels and ordering
 * stay with the storefront.
 */
export interface ProductDetails {
  productId: ProductId;
  /** Every variant that can be tried on. */
  variants: readonly ProductVariant[];
  /** Which library revision and publication the shop serves, and each size's stored drape. */
  provenance?: ListingProvenance;
}

export interface CatalogApi {
  /** The ids of the calling shop's products that can be tried on. */
  listProducts(args: Record<string, never>, options?: CallOptions): Promise<ApiResult<ProductId[]>>;

  /** One of the calling shop's products; any other id fails with `product-not-found` (404). */
  getProductDetails(
    args: GetProductDetailsArgs,
    options?: CallOptions,
  ): Promise<ApiResult<ProductDetails>>;

  /**
   * A product by the id the storefront uses for it. `product-not-found` (404) means it cannot be
   * tried on, so hide the try-on entry point.
   */
  getProductByForeignId(
    args: GetProductByForeignIdArgs,
    options?: CallOptions,
  ): Promise<ApiResult<ProductDetails>>;
}
