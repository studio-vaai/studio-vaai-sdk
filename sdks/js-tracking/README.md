# @studio-vaai/js-tracking

Typed analytics events and a fetch transport for studio vaai analytics.

```ts
import { createFetchTrackingClient } from "@studio-vaai/js-tracking";

const tracking = createFetchTrackingClient({
  clientApiKey: "sv_client_…",
  sdkVersion: "my-integration@1.0.0",
  distinctId: "visitor-id",
  // baseUrl: "https://a.studio-vaai.com", // default; override for local development
});
tracking.trackEvent({ name: "consent-granted", data: { "product-id": "p1" } });
```

When using `js-client`, reuse its key and fetch implementation:

```ts
const tracking = client.analytics.createTrackingClient({ sdkVersion: "my-integration@1" });
```

React providers create this transport automatically unless supplied with an explicit
`tracking` implementation. Requests use your existing `X-Client-Api-Key`. Browser
events must originate from one of the shop's allowed storefront origins.

Events use `fetch` with `keepalive: true`, `credentials: "omit"`, and JSON POSTs to
`/api/send`. Context is derived from browser APIs and supports defaults and per-event
overrides. The return value reports whether the request was queued, not delivered.
Asynchronous errors are absorbed so analytics cannot interrupt the host application.
