# studio vaai for Flutter

`studio_vaai` brings studio vaai virtual try-on to Flutter and Dart apps. It is a thin Dart layer
over the [SDK core](../core-rs/README.md): the try-on state machine and the public API client are
the same Rust code the iOS, Android and web SDKs run, called through Dart bindings that
[uniffi-dart](https://github.com/Uniffi-Dart/uniffi-dart) generates from the same UniFFI
annotations as the Swift, Kotlin and TypeScript bindings.

Status: a first, headless version. It runs one try-on journey (session, photo, height, try-on)
with no UI; widgets, persisted sessions and prebuilt binaries come later.

## Use

```dart
import 'package:studio_vaai/studio_vaai.dart';

final sdk = StudioVaai(clientApiKey: 'sv_client_...');
final product = await sdk.product(productId);

// Only once the shopper has agreed to the processing of their photo.
final journey = await sdk.startTryOn(consent: DataProcessingConsent.granted);
journey.showProduct(product);
final body = await journey.uploadPhoto(photoBytes, mimeType: 'image/jpeg');
await journey.setHeight(body.estimatedHeightCm);
final tryOn = await journey.tryOn(product.variants.first.id);
print(tryOn.imageUrl);

journey.dispose();
sdk.dispose();
```

- `StudioVaai` holds the shop's client key and the generated `ApiClient`. Every request goes
  through an `HttpTransport`: by default `IoHttpTransport` (`dart:io`), or your own.
- `TryOnJourney` drives the shared state machine (`TryOnSession`) as its adapter contract asks:
  one effect driver, batches started in order and acknowledged, every operation's outcome
  reported back. It performs each job with the core's own API helpers, so retries,
  classification of API problems and credential refresh are the same as on the web.
  `snapshot`, `changes` and `events` are the domain's state and events, for a UI.
- A call the state machine refuses throws its `TryOnException` and changes nothing. A photo it
  cannot use throws `PhotoRejectedException`, a size the backend will not try on
  `TryOnRefusedException`.
- `package:studio_vaai/api.dart` exports the whole generated API client,
  `package:studio_vaai/core.dart` the core's own helpers, and `package:studio_vaai/testing.dart`
  `ScriptedApi`, a scripted API for tests and demos.

A native app keeps no cookies, so the journey always takes a bearer session.

## Native library

The core is a Rust library, bundled as the bindings' native asset by this package's build hook
(`hook/build.dart`): it runs `cargo build` for the app's target from `../core-rs`, so building an
app needs the Rust toolchain that `core-rs/rust-toolchain.toml` pins. Android (arm64, linked with
the NDK's clang that Flutter passes to the hook), macOS (arm64 and x86_64) and iOS (arm64 devices; arm64 and x86_64
simulators) work. To bundle a library you built yourself instead, set it in your app's pubspec:

```yaml
hooks:
  user_defines:
    studio_vaai:
      core_library: path/to/libstudio_vaai_core.dylib
      # or cargo_profile: debug, for faster builds while developing
```

## Develop

The generated bindings are not committed. Generate them, then test:

```sh
(cd ../core-rs && just dart)   # into lib/src/generated
dart pub get
dart test                      # the real core against ScriptedApi
(cd example && flutter test)   # the example's session in the Flutter test engine
```

`just dart` builds the pinned generator first (see `../core-rs/patches/uniffi-dart`).

## License

MIT. See [LICENSE](LICENSE).
