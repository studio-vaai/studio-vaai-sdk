# Migration: `@studio-vaai/*` 0.2 → 0.3

A consumer-breaking release focused on install DX, a smaller public surface, and
first-class styling overrides. Summary of what changed and how to update.

## 1. Single install (no action needed — this only removes friction)

`react-components` / `react-headless` now declare their lower `@studio-vaai/*`
layers (and `@xstate/react`) as regular `dependencies`. Installing one package
pulls the rest transitively. You can drop the extra packages from your own
`package.json` and keep only what you import directly, plus the peers:

```sh
npm i @studio-vaai/react-components react react-dom   # + xstate if you use it directly
```

## 2. Removed `react-headless` subpaths

`@studio-vaai/react-headless/client` and `@studio-vaai/react-headless/machine`
are gone (they were pass-throughs). Import from the owning package instead:

```diff
- import { StudioVaaiClient } from "@studio-vaai/react-headless/client";
+ import type { StudioVaaiClient } from "@studio-vaai/js-client";
- import { defaultRootMachine } from "@studio-vaai/react-headless/machine";
+ import { defaultRootMachine } from "@studio-vaai/js-machine";
```

## 3. `react-headless` no longer re-exports lower layers

It exports only its own surface (provider, hooks, view-model, errors). Import
domain types/helpers from the package that defines them:

```diff
- import { TryOnFlowProduct, createLocalStorageSessionPersistence } from "@studio-vaai/react-headless";
+ import type { TryOnFlowProduct } from "@studio-vaai/js-machine";
+ import { createLocalStorageSessionPersistence } from "@studio-vaai/js-machine";
- import { createFetchStudioVaaiClient } from "@studio-vaai/react-headless";
+ import { createFetchStudioVaaiClient } from "@studio-vaai/js-client";
```

## 4. `js-machine` surface trimmed

Removed (were unused): the dead `globalFlowMachine`, `productFlowMachine`,
`productOverviewMachine`, `tryOnPipelineMachine` and their
`GlobalFlow*`/`ProductFlowContext`/`ProductFlowInput` types; the individual child
machine **values** (`sessionIntroMachine`, `photoCaptureMachine`, …); the
`getInvokedChild` helper and `TRY_ON_REQUEST_INVOKE_ID`/`TRY_ON_RESULT_INVOKE_ID`
constants. The child machines' **event/output/snapshot types** remain exported
(they appear in the root snapshot). Use `defaultRootMachine` + the provider.

## 5. New: styling without swapping components

```tsx
<StudioVaaiDefaultFlow
  theme={{ "--sv-color-primary": "#6E59F7", "--sv-radius-button-primary": "9999px" }}
  classNames={{ shell: { title: "font-serif", footer: "border-t" }, backdrop: "backdrop-blur-sm" }}
/>
```

- `theme` (`SvTokenOverrides`) now reaches the **portaled** sheet/modal — previously
  token overrides silently dropped at the portal boundary.
- `classNames.shell` (`SheetShellClassNames`) restyles the sheet chrome per slot.
- The `components` override map is unchanged and remains the escape hatch for
  full component replacement.

# Migration: product variants (API `2026-11-05`)

A hard switch with no compatibility period: the API now speaks your shop's own ids, and a try-on
names a variant by `id`. Your storefront stays the catalog; labels, images, ordering and prices
are no longer served to you.

## HTTP

| Before                                                      | Now                                                                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /products/{id}/listing`                                | `GET /products/{id}` and `GET /products/by-foreign-id/{foreignId}`: `{ productId, variants: [{ id, foreignVariantIds, foreignId? }] }`. 404 `product-not-found` |
| `GET /products` listed names, prices and images             | `{ products: [{ productId }] }`                                                                                                                                 |
| `POST /products/{id}/try-on` body `{ attributes }`          | body `{ variantId }`                                                                                                                                            |
| Try-on success and rejection had `requestedSize`            | optional `variantId`                                                                                                                                            |
| 422 rejection `recommendedSize`                             | `recommendedForeignIds`                                                                                                                                         |
| `recommended-size`: `recommendedSize`, `recommendedOptions` | `recommendedForeignIds`                                                                                                                                         |
| `recommended-size`: `recommendations[].size`, `options`     | `recommendations[].foreignIds`                                                                                                                                  |
| `fit` on product details                                    | gone; the intended fit comes from the size recommendation's `fitChecks`                                                                                         |
| Errors `variant-incomplete`, `invalid-variant-attributes`   | gone; `invalid-variant-id` for a malformed `variantId`, `variant-not-found` for one the product does not sell                                                   |

`foreignVariantIds` keys are `colorway`, `size`, further axes such as `style`, and `template` only on a
multi-template product. Recommendations and rejections name a size in `foreignIds`, which never holds
`colorway` or `template`.

## `@studio-vaai/js-client`

- `catalog.listProducts` returns product ids.
- `catalog.getProductListing` is gone: use `catalog.getProductDetails({ productId })` or
  `catalog.getProductByForeignId({ foreignId })`.
- `CatalogProduct`, `ProductListing`, `GetProductListingArgs` and the merchandising `Listing*`
  types are gone. `ListingProvenance` and its parts stay, on `ProductDetails.provenance`.
- `createTryOn({ session, bodyId, productId, variantId })` replaces `attributes`.
- New: `sizeKeyOf(foreignIds)`, the single string naming a size: `M`, or `27 / 30` on several axes.
- `RecommendedSizeData`, `SizeRecommendation` and `TryOnFailureReason` keep their shape: `size`,
  `recommendedSize` and `wornSize` are now that size key in your ids, and `options` and
  `recommendedOptions` are the ids per axis.

## `@studio-vaai/js-machine`

The attribute key `color` is now `colorway`, and selections hold your ids:

```diff
- selection: { color: "espresso", size: "m" }
+ selection: { colorway: "A100-259", size: "M" }
```

| Before                                   | Now                                     |
| ---------------------------------------- | --------------------------------------- |
| `attributeMetadata.colors`               | `attributeMetadata.colorways`           |
| `TryOnProductColorOption`                | `TryOnProductColorwayOption`            |
| `tryOnColorOptionForAttribute`           | `tryOnColorwayOptionForAttribute`       |
| `TryOnFlowProductVariant { attributes }` | `{ id, attributes }`                    |
| `tryOnRequestAttributes`                 | removed; the machine sends `variant.id` |
| `TryOnRequestInput.attributes`           | `variantId`                             |

On a waist × length product, `size` is the size key (`27 / 30`) and each
`attributeMetadata.sizes[]` entry names its ids per axis in `options`.

Build the product from your own merchandising and the API's variants instead of by hand:

```ts
const product = buildTryOnFlowProduct({
  productId: details.productId,
  displayName: "Linen Blazer",
  variants: details.variants,
  axes: [
    {
      key: "colorway",
      label: "Colour",
      items: [{ key: "A100-259", display: { text: "Espresso", hex: "#3b2a20" } }],
    },
    { key: "size", label: "Size", items: [{ key: "M", display: { text: "Medium" } }] },
  ],
});
```

Your axis and item order is the display order; the API has no ordering.

## `@studio-vaai/react-components`

- `onAddToCart`, `onTryOnClose` and `onTryOnRendered` also hand back `variantId`, `foreignVariantIds`
  (your ids on every axis, colorway included) and, when known, `foreignId` (your own id for the
  combination), which is what a cart needs.
- `VariantPicker` overrides: `colors`, `selectedColor`, `onSelectColor`, `colorLabel` and
  `VariantPickerColor` are now `colorways`, `selectedColorway`, `onSelectColorway`, `colorwayLabel`
  and `VariantPickerColorway`. The swatch row's `data-sv-axis` is `colorway`.

## Analytics

Selected variants flatten to `variant-<axis>` keys, so `variant-color` becomes `variant-colorway`,
and the values are your ids.
