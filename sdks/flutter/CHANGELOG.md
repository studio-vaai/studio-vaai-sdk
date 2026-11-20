## 0.1.0-dev.1

First preview release. The API may change in any later 0.1.0 preview.

- A headless try-on journey (`StudioVaai`, `TryOnJourney`): product, consent, photo, height and
  try-on, driven by the shared Rust SDK core through UniFFI-generated Dart bindings.
- `IoHttpTransport` sends the requests the core builds with `dart:io`; `ScriptedApi`
  (`package:studio_vaai/testing.dart`) scripts the API for tests and demos.
- Prebuilt core libraries for Android (arm64-v8a, armeabi-v7a, x86_64), iOS (devices; arm64 and
  x86_64 simulators) and macOS (arm64, x86_64): the build hook downloads the one an app's target
  needs from the release on GitHub, checks its SHA-256 and caches it. No Rust toolchain needed.
