## 0.2.0

In lockstep with the web SDK's 0.2.0 packages.

### Behaviour changes

- The fit score is now off by default. Set `fitScore: true` on `StudioVaaiTryOn` to show it on
  each result, with the intended fit and the fit callouts. The size recommendation and the note
  for a size that does not fit work either way.
  **Migration:** to keep the fit score, add `fitScore: true` to `StudioVaaiTryOn`.
- The size your product page shows (an axis in `chosenAxes`) stays the shopper's choice: the
  try-on opens on it, and the size recommendation no longer replaces it. Only a size that does
  not fit moves, to the next size that does.
- Analytics no longer send a visitor ID, device context or the SDK version. The `visitorId`,
  `context` and `sdkVersion` parameters of `createTryOnAnalytics` are ignored, and
  `analyticsVisitorId()` is deprecated.

### New

- Earlier try-ons come back when the app is relaunched, with their results. A launch without a
  connection keeps them for the next one. The device keeps only their IDs, never an image.
- The variant picker labels the size and colour rows when your catalogue names no axis.
- The picker marks the variants the shopper has already tried with a check mark, and choosing
  one shows its result at once.
- When a size does not fit, a note on the size row names the next size that fits, and the
  button offers to try it on.
- `TryOnTokens.buttonRadius` shapes the buttons alone, for example as pills with
  `TryOnTokens.radiusFull`. It follows `radius` until you set it.
- `CommerceAnalyticsEvent` accepts an optional `variantId` and `recommendedForeignIds`.
- `ScriptedApi` scripts the fit gate (`fitGate`) and a body whose photo is no longer stored
  (`storesPhoto: false`), and returns its try-ons for a relaunch.

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
- In wide windows the layout matches the web's dialog.
- The buttons stay in place at the bottom of every screen, and the content above them scrolls.
- Titles and subtitles wrap to a second line instead of being cut off.

## 0.1.1

Initial release. While the version is 0.x, a minor version can change the API, as in the studio
vaai web SDK.

- Ready-made widgets (`package:studio_vaai/widgets.dart`): `StudioVaaiTryOn` presents the default
  try-on experience (consent, library photo or camera self-timer, height, variant selection,
  try-ons with fit score, add to bag) from the core's default flow, with the web SDK's copy
  (English, German, host overrides), design tokens (light and dark) and accessibility. Camera and
  library through `camera` and `image_picker`; `ScriptedDevices` for tests. Requires Flutter 3.44
  (Dart 3.12).
- The web's look and behaviour: Inter bundled, the web's header, fit details (score, per-metric
  callouts), pinch zoom on the result, and its two-column layout in wide windows.
- The session and the body made from the shopper's photo are kept between launches in the
  platform's secure storage and restored through the core, until the API expires the session
  (`keepSession`, `sessionStore`).
- HEIC photos are uploaded as JPEG, decoded by the platform, or refused; the API's JPEG XL photos
  are decoded by the core where the platform cannot (`TryOnNetworkImage`).
- studio vaai analytics (`createTryOnAnalytics`, `package:studio_vaai/analytics.dart`): the same
  requests as the web SDK for the try-on's events, with `StudioVaaiTryOn(analytics: …)` and the
  shop's own events (entry point impression, cart item, order, experiment).
  `TryOnExperience.tryOnEvents` delivers the web's `sv-try-on-*` events.
- A headless try-on journey (`StudioVaai`, `TryOnJourney`): product, consent, photo, height and
  try-on, driven by the shared Rust SDK core through UniFFI-generated Dart bindings.
- `IoHttpTransport` sends the requests the core builds with `dart:io`; `ScriptedApi`
  (`package:studio_vaai/testing.dart`) scripts the API for tests and demos.
- Prebuilt core libraries for Android (arm64-v8a, armeabi-v7a, x86_64), iOS (devices; arm64 and
  x86_64 simulators) and macOS (arm64, x86_64): the build hook downloads the one an app's target
  needs from the release on GitHub, checks its SHA-256 and caches it. No Rust toolchain needed.
