# @studio-vaai/js-tracking

Typed analytics events and a fetch transport for studio vaai analytics.

```ts
import { createFetchTrackingClient } from "@studio-vaai/js-tracking";

const tracking = createFetchTrackingClient({
  clientApiKey: "sv_client_…",
  // baseUrl: "https://a.studio-vaai.com", // default; override for local development
});
tracking.trackEvent({ name: "consent-granted", data: { "product-id": "p1" } });
```

When using `js-client`, reuse its key and fetch implementation:

```ts
const tracking = client.analytics.createTrackingClient({});
```

React providers create this transport automatically unless supplied with an explicit
`tracking` implementation. Requests use your existing `X-Client-Api-Key`. Browser
events must originate from one of the shop's allowed storefront origins.

Events use `fetch` with `keepalive: true`, `credentials: "omit"`, and JSON POSTs to
`/v2/events`. Each occurrence gets a fresh event UUID. The transport sends the typed event
properties without browser context, visitor IDs or shopper credentials.
The collector uses the UUID to deduplicate repeat deliveries of that occurrence.
The `sdkVersion` option is accepted for compatibility and is omitted from the payload.
