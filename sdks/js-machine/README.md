# @studio-vaai/js-machine

Framework-agnostic state machine for the studio vaai **virtual try-on** journey, built on
[XState](https://stately.ai/docs/xstate) v5. No React — HTTP calls go through a
`StudioVaaiClient` you inject from [`@studio-vaai/js-client`](https://www.npmjs.com/package/@studio-vaai/js-client).

> Using React? Reach for [`@studio-vaai/react-headless`](https://www.npmjs.com/package/@studio-vaai/react-headless),
> which wraps this machine in hooks and a provider. Use `js-machine` directly only for
> non-React hosts or a custom integration.

## Install

```bash
npm install @studio-vaai/js-machine @studio-vaai/js-client
```

`@studio-vaai/js-tracking` and `xstate` are pulled in as regular dependencies — no extra
install needed.

## `defaultRootMachine`

The single exported machine value. It composes the full try-on journey: a global prefix
(`sessionIntro` → `photoUpload` → `bodyHeightCalibration`) followed by a `product`
**parallel** region with three siblings:

| Region               | Role                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`variant`**        | Variant / overview. The host passes a `product` from `buildTryOnFlowProduct`; the machine resolves the picked variant from its attributes and passes its `id` to `createTryOn`. |
| **`recommendation`** | `hidden` → `loading` → `visible` \| `error`; `dismissed` when dismissed.                                                                                                        |
| **`tryOnPipeline`**  | Sequential: `tryOnRequest` → `tryOnResult`.                                                                                                                                     |

The root handles these navigation events:

- **`PRODUCT_CHANGED`** — reset the product flow and update `productId` / `selection`.
- **`BACK_TO_HEIGHT`** — jump back to body height calibration.
- **`RESET_PRODUCT`** — clear the variant selection while keeping the current product id.

> The child machines (`sessionIntro`, `photoCapture`, `photoUpload`,
> `bodyHeightCalibration`, `tryOnRequest`, `tryOnResult`) are composed **internally** and are
> no longer exported as values. Their event/output/snapshot **types** stay public (they appear
> transitively in the root snapshot), so consumers can name them.

## Session expiry

On session expiry, including after page resume, the root machine clears shopper
state and the persisted handle. It aborts owned requests on exit and checks stored
expiry before restoration. Hosts must manage any copies or saved results they keep.

## Exports

- **`defaultRootMachine`** — the machine value; `DefaultRootMachine`, `DefaultRootEvent`,
  `DefaultRootContext`, `DefaultRootInput` types.
- **Domain types** — `TryOnFlowProduct`, `TryOnFlowProductVariant`,
  `TryOnFlowProductAttributeMetadata`, `VariantAttributes`, plus per-step context/input/event
  types (`SessionIntro*`, `PhotoCapture*`, `PhotoUpload*`, `BodyHeightCalibration*`,
  `TryOnRequest*`, `TryOnResult*`).
- **Helpers** — `buildTryOnFlowProduct`, `findVariantByAttributes`, `variantForeignIds`,
  `frameLockFromCenterCrop`, `tryOnColorwayOptionForAttribute`, `tryOnSizeLabelForAttribute`,
  `selectProductTryOnHistory`, `isStandardError`, `transportErrorFromActor`, `unwrapApiFailure`.
- **Session persistence** — `createLocalStorageSessionPersistence`,
  `createMemorySessionPersistence`, `createNoopSessionPersistence`,
  `sessionLocalStorageKeyForBasePath`, `SessionPersistenceAdapter`.
- **Tracking glue** — `createTrackingSubscriber`, `stepFromSnapshot`, `TrackingSubscriber`,
  `AnalyticsSignal`, `HostAnalyticsSignal` (re-exports `ImageFlowSource` from
  `@studio-vaai/js-tracking`).

## Usage

Pass `{ client }` (and any product-specific fields) through `defaultRootMachine`'s `input`.
Drive it with `createActor(defaultRootMachine, { input }).start()`, or — in React — let
`@studio-vaai/react-headless` mount it via `StudioVaaiProvider`.

## Building the product

The shop supplies labels, images, ordering and price as axes; the API supplies the variants.
The host's axis and item order is the display order, and every item `key` is the shop's own id,
matching the variants' `foreignVariantIds`:

```ts
import { buildTryOnFlowProduct } from "@studio-vaai/js-machine";

const details = await client.catalog?.getProductByForeignId({ foreignId: "A100" });
if (details?.ok !== true) {
  return; // `product-not-found`: hide the try-on button.
}
const product = buildTryOnFlowProduct({
  productId: details.data.productId,
  displayName: "Linen Blazer",
  priceLabel: "€159",
  variants: details.data.variants,
  ...(details.data.fit === undefined ? {} : { fit: details.data.fit }),
  axes: [
    {
      key: "colorway",
      label: "Colour",
      items: [{ key: "A100-259", display: { text: "Espresso", hex: "#3b2a20" } }],
    },
    {
      key: "size",
      label: "Size",
      items: [
        { key: "S", display: { text: "Small" } },
        { key: "M", display: { text: "Medium" }, soldOut: true },
      ],
    },
  ],
});
```

The selection holds the same ids: `{ colorway: "A100-259", size: "S" }`, plus `template` on a
multi-template product. `size` is the size key (`sizeKeyOf`), so a waist × length pick reads
`size: "27 / 30"`.

## License

MIT
