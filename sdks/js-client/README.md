# @studio-vaai/js-client

TypeScript client for the studio vaai virtual try-on HTTP API.

This package is the public **contract**: request/response types, the `StudioVaaiClient`
interface, and a ready-to-use `fetch`-based transport. It runs in both the browser and Node.

## Install

```bash
npm install @studio-vaai/js-client
```

## Usage

```ts
import { createFetchStudioVaaiClient } from "@studio-vaai/js-client";

const client = createFetchStudioVaaiClient({
  baseUrl: "https://api.studio-vaai.com",
  clientApiKey: "your-client-api-key",
});

const result = await client.session.createSession({
  dataProcessingConsent: true,
});
```

`client` implements `StudioVaaiClient`, with one namespace per API area:

| Namespace            | Methods                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `client.meta`        | `getHealth`                                                          |
| `client.session`     | `createSession`, `getSession`, `refreshSession`, `invalidateSession` |
| `client.body`        | `listBodies`, `createBody`, `setBodyHeight`                          |
| `client.tryOn`       | `createTryOn`, `getTryOn`, `getRecommendedSize`                      |
| `client.analytics`   | `createTrackingClient` (local factory; no configuration request)     |
| `client.experiments` | `evaluateFlag`, `evaluateFlagsBulk`, `getTryOnDecision`              |
| `client.catalog`     | `listProducts`, `getProductDetails`, `getProductByForeignId`         |

`client.catalog` is an optional member of the interface; the fetch client has it.

## Products and variants

The API speaks your shop's ids. A product's variants name every axis in them, and a try-on takes
a variant's `id`:

```ts
const details = await client.catalog?.getProductByForeignId({ foreignId: "A100" });
if (details?.ok !== true) {
  // `product-not-found` (404): this product cannot be tried on, so hide the try-on button.
  return;
}
const variant = details.data.variants.find(
  (candidate) =>
    candidate.foreignVariantIds["colorway"] === "A100-259" &&
    candidate.foreignVariantIds["size"] === "M",
);
```

Labels, images, ordering and prices stay with your storefront. `sizeKeyOf(foreignIds)` gives the
one string that names a size (`M`, or `27 / 30` on a waist × length product); recommendations
and size rejections are keyed by it. A variant's `foreignVariantIds` holds `colorway`, `size`, any further axis such
as `style`, and `template` only on a product with several templates.

## Analytics

Create a tracking client locally using the API client's existing key and fetch
implementation:

```ts
const tracking = client.analytics.createTrackingClient({
  sdkVersion: "my-storefront@1.0.0",
  distinctId: "anonymous-visitor-id",
});
tracking.trackEvent({
  name: "cart-item-added",
  data: { "product-id": "longsleeve", "variant-size": "M" },
});
```

Events POST immediately to `https://a.studio-vaai.com/api/send` using the existing
client API key. Browser collection omits shopper credentials and cookies.
`trackEvent` reports whether delivery was queued, not acknowledged.

React providers create this transport and send flow events automatically. Avoid
duplicating those events; send storefront cart and order events yourself. For local
development, set `analyticsBaseUrl` when creating the fetch API client.

## Session transport

`createFetchStudioVaaiClient({ clientApiKey, sessionTransport })` accepts:

- `auto` (the default): in browsers, prepare cookie creation, then verify the preparation cookie while creating the session. Native/server environments use bearer.
- `cookie`: require an HttpOnly cookie; return `session_transport_unavailable` when cookies cannot be used. Never fall back to bearer.
- `bearer`: manage the token explicitly and send it in `Authorization`.

Cookie mode uses shop-scoped Secure, HttpOnly, SameSite=None, Partitioned cookies. It never
returns the cookie credential to JavaScript. The returned `session` is a non-secret shop/API
marker; pass it unchanged to SDK methods. Bearer handles remain tokens. Session results also
include `sessionTransport` and `expiresAt` when using the fetch client.

Auto falls back only on `session-cookie-unavailable`, which guarantees no session was created, never after other errors or an uncertain creation request. The actual cookie session is checked after creation;
subsequent failures never convert it to bearer. Restore existing handles with `getSession`;
auto preserves existing bearer sessions, while explicit modes reject incompatible handles.

Handles are not persisted automatically. Always retain the handle returned by refresh.

Sessions expire after 60 minutes of inactivity; `expiresAt` includes this idle
deadline. Accepted photo submissions, height calibrations and try-on requests,
including companion renders, renew activity. Reads, polling, upload preparation
and credential refresh do not. The server determines activity; callers cannot
override it. `onSessionActivity` lets the supplied state machine follow accepted
processing for each session. Custom transports must respect `AbortSignal`.

Cookie storage is managed by the browser; native/server cookie mode needs a custom cookie-aware
fetch implementation. The wire API has separate cookie and bearer creation/refresh endpoints; `auto` is SDK policy.

See [Authentication](https://docs.studio-vaai.com/api/authentication) for examples and storage/expiry guidance.

## Results and errors

Methods return an `ApiResult<T>` — a discriminated union you inspect, rather than a value
that throws:

```ts
const result = await client.body.listBodies({/* … */});
if (result.ok) {
  result.data; // typed payload
} else {
  result.error; // StandardError — kind, message, details
}
```

`ApiFailureError` carries an `ApiFailure` payload for the cases where a failure is thrown
rather than returned.

## Versioning

Business API requests carry an `X-Client-Version` header so the server can match the contract.
The value is a constant you can read:

```ts
import { API_VERSION, CLIENT_VERSION_HEADER_VALUE } from "@studio-vaai/js-client";
```

`API_VERSION` is a calendar-style contract date, independent of this package's npm version.
Analytics POSTs use `X-Client-Api-Key` without a business API version or shopper session header.

## License

MIT
