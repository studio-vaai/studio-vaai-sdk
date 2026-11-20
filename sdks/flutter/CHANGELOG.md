## 0.1.0

First release, in lockstep with the web SDK's 0.1.0 packages. 0.x: the API can change between
minor versions, like the web SDK.

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
- studio vaai analytics (`createTryOnAnalytics`, `package:studio_vaai/analytics.dart`): the web
  SDK's mapping of the try-on's events to the analytics catalogue, request for request (checked
  against the web's mapper), with `StudioVaaiTryOn(analytics: …)` and the shop's own events
  (entry point impression, cart item, order, experiment). `TryOnExperience.tryOnEvents` delivers
  the web's `sv-try-on-*` events.
- A headless try-on journey (`StudioVaai`, `TryOnJourney`): product, consent, photo, height and
  try-on, driven by the shared Rust SDK core through UniFFI-generated Dart bindings.
- `IoHttpTransport` sends the requests the core builds with `dart:io`; `ScriptedApi`
  (`package:studio_vaai/testing.dart`) scripts the API for tests and demos.
- Prebuilt core libraries for Android (arm64-v8a, armeabi-v7a, x86_64), iOS (devices; arm64 and
  x86_64 simulators) and macOS (arm64, x86_64): the build hook downloads the one an app's target
  needs from the release on GitHub, checks its SHA-256 and caches it. No Rust toolchain needed.
