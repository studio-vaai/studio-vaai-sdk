# Changelog

Changes to the web SDK: `@studio-vaai/core`, `@studio-vaai/web-components`, `@studio-vaai/react`
and `@studio-vaai/vue`. The four packages are released together under the same version. The
Flutter package `studio_vaai` has its own [changelog](flutter/CHANGELOG.md).

## 0.2.0

### Behaviour changes

- The fit score is now off by default. Opt in to show it on each result, with the intended fit
  and the fit callouts. The size recommendation and the note for a size that does not fit work
  either way.
  **Migration:** to keep the fit score, add `fitScore` to `<StudioVaaiTryOn>` in React, `fit-score`
  in Vue, or the `fit-score` attribute (`fitScore` property) to `<sv-try-on-experience>`.
- The size your product page selects stays the shopper's choice: the try-on opens on it, and the
  size recommendation no longer replaces it. Only a size that does not fit moves, to the next
  size that does.
- Analytics no longer send a visitor ID or the SDK version. The `visitorId` and `sdkVersion`
  options are ignored, and `getAnalyticsVisitorId()` is deprecated.

### New

- Earlier try-ons come back after a page reload, with their results. The browser keeps only
  their IDs, never an image.
- The variant picker labels the size and colour rows when your catalogue names no axis.
- The picker marks the variants the shopper has already tried with a check mark, and choosing
  one shows its result at once.
- When a size does not fit, a note on the size row names the next size that fits, and the
  button offers to try it on.
- `--sv-button-radius` shapes the buttons alone, for example as pills. It follows `--sv-radius`
  until you set it.
- New events `sv-try-on-operation-slow` and `sv-try-on-operation-deadline`.
  `sv-try-on-requested` and `sv-try-on-add-to-cart-requested` carry `recommendedForeignIds`,
  and `sv-try-on-presented` carries `foreignIds`.
- `CommerceAnalyticsEvent` accepts an optional `variantId` and `recommendedForeignIds`.
- Two new photo rejection reasons: `multiple-people` and `feet-not-visible`.

### Improvements and fixes

- Uploading a photo no longer opens a separate processing screen. The screen the photo was
  chosen from shows the progress, and the try-on moves on when the photo is accepted.
- A restored session shows the shopper's cut-out from their photo. If the photo is no longer
  stored, the try-on asks for a new one instead of showing an error.
- A try-on whose response was lost, for example to a dropped connection, can be retried and
  keeps the shopper's photo. A retry never creates a second try-on.
- A session the API no longer accepts (401) now ends cleanly, and the shopper starts a new one.
- Fit callouts: one per measurement, with readable names, placed beside the person and anchored
  on the garment. The length is marked with a tick across the hem.
- The camera captures a sharper picture, shows an upright camera's whole frame, and uploads
  exactly what the preview shows.
- HEIC photos are converted in every storefront: the conversion worker now loads from the
  package instead of the storefront's own domain.
- Dialog titles wrap instead of being cut off, and on phones the variant picker stays inside the
  sheet, with the result in view above it.
- React: the closing analytics event is sent when the storefront unmounts the try-on.

### Moving from the legacy packages

`@studio-vaai/js-client`, `@studio-vaai/js-machine`, `@studio-vaai/js-tracking`,
`@studio-vaai/js-debugger`, `@studio-vaai/react-headless` and `@studio-vaai/react-components`
are no longer maintained. Use `@studio-vaai/react`, `@studio-vaai/vue` or
`@studio-vaai/web-components` with `@studio-vaai/core` instead. See the
[migration guide](MIGRATION.md) and the [web SDK documentation](https://docs.studio-vaai.com/sdk/web).

## 0.1.0

First release of the web SDK on the shared Rust core: `@studio-vaai/core`,
`@studio-vaai/web-components`, `@studio-vaai/react` and `@studio-vaai/vue`.
