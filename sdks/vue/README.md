# `@studio-vaai/vue`

Add the studio vaai try-on experience to a Vue 3 storefront. The SDK accepts Vue
`^3.0.0`. Install `@studio-vaai/vue` alongside your application's Vue dependency.

Mount `StudioVaaiTryOn` once per shop. Change the product props as shoppers browse
and use `active` to disable the experience away from product pages while keeping
the shopper session. Browser initialization starts after Vue mounts the component.

```vue
<template>
  <button type="button" :disabled="!ready" @click="openTryOn">Try it on</button>
  <StudioVaaiTryOn
    ref="tryOn"
    :api="api"
    :product-id="productId"
    :product-name="productName"
    :present-product="presentProduct"
    :add-to-cart="addToCart"
    @readyChange="ready = $event"
  />
</template>
```

Import `StudioVaaiTryOn` from `@studio-vaai/vue` and bind the template ref in
`setup()` or `<script setup>`:

```ts
import { StudioVaaiTryOn, type StudioVaaiTryOnHandle } from "@studio-vaai/vue";
import { ref } from "vue";

const tryOn = ref<StudioVaaiTryOnHandle | null>(null);
const ready = ref(false);
const openTryOn = () => tryOn.value?.open({ entry: "product-page" });
```

Pass your public API configuration, product ID and name, and a `presentProduct`
callback that maps the returned product details to storefront labels and choices.
Return initial prices and stock from `presentProduct`. Use the optional `commerce`
prop to update them. The optional `addToCart` callback receives the exact variant
and may return a promise. Resolving
it closes the experience. Listen to `error` for SDK errors and `event` for try-on
events, or pass analytics created with the package's `createTryOnAnalytics`.
