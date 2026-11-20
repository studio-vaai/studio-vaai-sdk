# studio vaai for Flutter

`studio_vaai` brings studio vaai virtual try-on to Flutter and Dart apps. It is a thin Dart layer
over the [SDK core](https://github.com/studio-vaai/studio-vaai-sdk/blob/main/sdks/core-rs/README.md): the try-on state machine and the public API client are
the same Rust code the iOS, Android and web SDKs run, called through Dart bindings that
[uniffi-dart](https://github.com/Uniffi-Dart/uniffi-dart) generates from the same UniFFI
annotations as the Swift, Kotlin and TypeScript bindings.

Status: **preview** (`0.1.0-dev.1`). It runs one try-on journey (session, photo, height, try-on)
with no UI; widgets and persisted sessions come later, and the API may change between previews.

## Install

```sh
flutter pub add studio_vaai:^0.1.0-dev.1
```

Android, iOS and macOS apps build with it as they are: no Rust toolchain is needed (see
[Native library](#native-library)). It needs Flutter 3.38 or later (Dart 3.10, which runs
packages' build hooks).

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
(`hook/build.dart`). Each release ships it prebuilt, release-optimized and stripped, for every
target Flutter builds:

| Platform | Targets                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| Android  | `arm64-v8a`, `armeabi-v7a`, `x86_64` (API 21+, 16 KB pages)                   |
| iOS      | arm64 devices; arm64 and x86_64 simulators (iOS 13+)                          |
| macOS    | arm64, x86_64 (macOS 10.15+; Flutter joins them into one universal framework) |

The hook downloads the library for the app's target from the package's GitHub release, the first
time an app builds for that target, and checks it against the SHA-256 that `hook/prebuilt.json`
in the published package pins: it never bundles other bytes. It keeps the download in the app's
`.dart_tool/`, so later builds, also offline, reuse it. It reads proxies from `HTTPS_PROXY`,
`HTTP_PROXY` and `NO_PROXY`.

Set these in your app's pubspec to change where the core comes from:

```yaml
hooks:
  user_defines:
    studio_vaai:
      # A mirror of the release's files (an http(s) or file URL, or a folder
      # relative to this pubspec), e.g. where builds have no internet access.
      # The checksums still apply.
      prebuilt_base_url: https://artifacts.example.com/studio_vaai/0.1.0-dev.1/
      # Or a core you built yourself, for this build's target.
      core_library: path/to/libstudio_vaai_core.dylib
```

In a checkout of the SDK repository, the hook builds the core from source instead
(`../core-rs`, with the Rust toolchain that `core-rs/rust-toolchain.toml` pins), for Android
with the NDK's clang that Flutter passes to the hook. `cargo_profile: debug` builds faster while
developing; `prebuilt: true` downloads instead, as from pub.dev.

The core links third-party crates; their licenses are in [NOTICES](NOTICES), which Flutter
shows on an app's license page.

## Develop

The generated bindings are not committed. Generate them, then test:

```sh
(cd ../core-rs && just dart)   # into lib/src/generated
dart pub get
dart test                      # the real core against ScriptedApi
(cd example && flutter test)   # the example's session in the Flutter test engine
```

`just dart` builds the pinned generator first (see `../core-rs/patches/uniffi-dart`). After a
change to the core's dependencies, `tool/notices.py` rewrites [NOTICES](NOTICES) (`just ci` in
`../core-rs` checks it).

## Releases

The SDK repository's `Flutter` workflow (`.github/workflows/flutter.yml`) builds the package on
every change and, for a tag `studio_vaai-v<version>`, releases it:

1. `tool/build_core.sh` builds the core for each target: Android on Linux with the NDK, Apple on
   macOS with Xcode.
2. `just dart` generates the bindings; `tool/prebuilt_manifest.dart` writes `hook/prebuilt.json`
   (file names, sizes and SHA-256 of exactly these libraries, and the tag's download URL).
3. `dart pub publish --dry-run` validates the package, and `--to-archive` packs it. The packed
   package runs its tests on macOS with no core sources, so its hook downloads the library, from
   the workflow's files.
4. On the tag only: a GitHub release with the libraries, the manifest, their SBOMs and the
   package archive, with build provenance attestations; then the archive is published to pub.dev.

Bump `version` in `pubspec.yaml` and add its `CHANGELOG.md` entry first.

pub.dev publishes from GitHub Actions only for a package that exists, so the first version goes
up by hand, from the tag's release: `dart pub publish --from-archive studio_vaai-<version>.tar.gz`
(the archive the workflow tested; `--from-archive` publishes it unchanged). Then, in the
package's admin page on pub.dev, move it to the `studio-vaai.com` verified publisher and enable
automated publishing from this repository with the tag pattern `studio_vaai-v{{version}}` and the
environment `pub.dev`; set the repository variable `PUB_DEV_AUTOMATED_PUBLISHING` to `true`, and
later tags publish themselves.

## License

MIT. See [LICENSE](LICENSE).
