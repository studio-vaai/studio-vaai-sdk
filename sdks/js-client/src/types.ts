/** Type-only opaque IDs (not checked at runtime). */

declare const BodyIdBrand: unique symbol;
declare const TryOnIdBrand: unique symbol;
declare const ProductIdBrand: unique symbol;
declare const SessionHandleBrand: unique symbol;

export type BodyId = string & { readonly [BodyIdBrand]: never };

export type TryOnId = string & { readonly [TryOnIdBrand]: never };

export type ProductId = string & { readonly [ProductIdBrand]: never };

/** Opaque session handle. Bearer mode holds a credential; cookie mode holds a non-secret scoped marker. */
export type SessionHandle = string & { readonly [SessionHandleBrand]: never };

/** Opaque IDs from OpenAPI string fields — runtime is plain string. */
export function sessionHandleFromApi(token: string): SessionHandle {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- branding API tokens
  return token as SessionHandle;
}

export function bodyIdFromApi(id: string): BodyId {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- branding body IDs
  return id as BodyId;
}

export function productIdFromApi(id: string): ProductId {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- branding product IDs
  return id as ProductId;
}

export function tryOnIdFromApi(id: string): TryOnId {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- branding try-on IDs
  return id as TryOnId;
}
