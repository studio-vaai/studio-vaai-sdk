# @studio-vaai/js-debugger

Development-time debugger for the studio vaai virtual try-on SDK.

It adds an on-screen panel that lets you inspect the SDK's state, watch the API call log, and
inject errors and body-validation failures — so you can exercise error and edge-case paths
without a real backend failure.

Captured diagnostics exclude shopper payloads, session credentials, photos, body
data and image URLs.

> Intended for development only. Do not ship it to production.

## Install

```bash
npm install --save-dev @studio-vaai/js-debugger
```

## Usage

Call `setupStudioVaaiDebugger()` once, early in your app's startup:

```ts
import { setupStudioVaaiDebugger } from "@studio-vaai/js-debugger";

if (import.meta.env.DEV) {
  setupStudioVaaiDebugger();
}
```

This mounts the `<studio-vaai-debugger>` panel and wraps every studio vaai client so the
debugger can observe and intercept calls. It returns an `uninstall` function for cleanup.

## Error injection

Drive failure states from code or from the panel:

```ts
import { injectError, clearError, injectBodyValidationFailure } from "@studio-vaai/js-debugger";

injectError(/* method + error kind */); // next matching call fails
clearError(/* method */); // back to normal
```

`getDebugState()` / `subscribeDebugState()` expose the current injections and the API call
log; `ALL_METHOD_IDS`, `STANDARD_ERROR_KINDS`, and `BODY_VALIDATION_CODES` enumerate the
valid targets.

## License

MIT
