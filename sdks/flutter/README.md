# studio vaai for Flutter

`studio_vaai` brings studio vaai virtual try-on to Flutter and Dart apps. It is a thin Dart layer
over the [SDK core](https://github.com/studio-vaai/studio-vaai-sdk/blob/main/sdks/core-rs/README.md): the try-on state machine and the public API client are
the same Rust code the iOS, Android and web SDKs run, called through Dart bindings that
[uniffi-dart](https://github.com/Uniffi-Dart/uniffi-dart) generates from the same UniFFI
annotations as the Swift, Kotlin and TypeScript bindings.

Status: `0.1.1`, in lockstep with the web SDK's 0.1 packages. Ready-made widgets present the default
try-on experience, and a headless journey drives it from your own UI. 0.x: the API can change
between minor versions, like the web SDK.

## Install

```sh
flutter pub add studio_vaai:^0.1.0
```

Android, iOS and macOS apps build with it as they are: no Rust toolchain is needed (see
[Native library](#native-library)). It needs Flutter 3.44 or later (Dart 3.12, which runs
packages' build hooks and which the `camera` plugin requires).

## Ready-made widgets

`StudioVaaiTryOn` is the Flutter counterpart of the web and React SDKs' `StudioVaaiTryOn`: the
whole default experience (consent, photo from the library or the camera's self-timer, height,
variant selection, try-ons, add to bag, and an optional fit score), with the web's screens, copy
and rules. The shared Rust core's default flow decides every screen and step; the widgets render its
view and send the shopper's actions back, so Flutter and the web behave the same.

```dart
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/widgets.dart';

final sdk = StudioVaai(clientApiKey: 'sv_client_...'); // one per shop
final tryOn = StudioVaaiTryOnController();

StudioVaaiTryOn(
  sdk: sdk,
  productId: productId, // or foreignId: your own product ID
  productName: 'Oxford shirt',
  // Your catalogue's axes, labels and selected variant for the API's variants.
  presentProduct: (details) => ProductPresentation(
    axes: [
      VariantAxis(
        role: AxisRole.size,
        key: 'size',
        label: 'Size',
        items: [for (final s in ['S', 'M', 'L']) AxisItem(key: s, display: TextItemDisplay(s))],
      ),
    ],
    variantId: details.variants.first.id,
    chosenAxes: ['size'], // the size the product page shows: the try-on opens on it
    commerce: {details.variants.first.id: const VariantCommerce(price: '€89')},
  ),
  controller: tryOn,
  locale: 'de', // default: the app's locale
  messages: {'sessionIntro.sheetTitle': 'Probier es an'}, // MF2 overrides, optional
  appearance: TryOnAppearance.dark,
  fitScore: true, // the fit score and its callouts on each result; off by default
  onAddToCart: (request) async => cart.add(request.variantId),
  onDownload: (bytes, mimeType) async => share(bytes), // optional; adds a download button
  onEvent: (event) => log(event), // the core's journey facts
  analytics: analytics, // studio vaai analytics, see below
  onError: (error) => log(error),
  onLink: (uri) => launchUrl(uri), // terms and privacy links
  child: ListenableBuilder(
    listenable: tryOn,
    builder: (context, _) => FilledButton(
      onPressed: tryOn.ready ? tryOn.open : null,
      child: const Text('Try it on'),
    ),
  ),
);
```

- Keep it mounted while the shopper browses: the session, photo, height and try-ons stay, and a
  new `productId` installs that product in the same session.
- The session, and the body made from the shopper's photo, outlast the app: the next launch
  restores them through the core's restore, as the web restores its session cookie and body
  selection, until the API expires the session (see [Kept sessions](#kept-sessions)).
- `simpleProductPresentation(details, roles: {'size': AxisRole.size})` builds a presentation from
  the API's variant IDs alone, for a start. List only the values the shop sells: the try-on offers
  exactly the axes' items you pass.
- A host's own button can name the variant with the catalog's `tryOnView.tryOnVariantCta` ("Try
  on M in Navy") or, once tried, `tryOnView.seeVariantCta` ("See M in Navy on you"), formatted with
  `TryOnMessages` (`sizeLabel`, `colorLabel`, `hasColor`).
- The page's size, default or picked, is the shopper's choice when its axis is in `chosenAxes`:
  the try-on opens on it, and the size recommendation leaves it be. Only the fit gate moves it:
  a size the gate refuses gives way to the next size along the run that fits, with a note on
  the size row ("Size XS is too small. We recommend size M.") and "Try on M in …" on the button.
  A size the shopper picks in the try-on stays when refused; the note and the button offer the
  next size instead.
- The fit score (its percentage, the intended fit and the callouts on the image) is off by
  default, as on the web: `fitScore: true` turns it on. The size recommendation and the fit
  gate's note work either way.
- It opens as a full-height modal sheet on phones and a centered dialog on wide windows, as the
  web SDK's dialog does (`presentation: TryOnPresentation.fullScreen` for a page). The system
  back gesture is the flow's Back, and Close at the start. To place the screens yourself, use
  `TryOnExperienceView` with a `TryOnExperience`.
- Text comes from the core's MessageFormat 2 catalog, the same keys and translations as the web
  (`TryOnMessages.locales`); `messages` overrides any key for the locale.
- Colors and sizes are the web components' design tokens (`TryOnTokens.light` and `.dark`):
  the same seeds, mix steps and derived colors. Brand them with
  `tokens: TryOnTokens.light.copyWith(primary: ...)`, and shape the buttons alone with
  `buttonRadius` (the web's `--sv-button-radius`; it follows `radius` until set, e.g.
  `TryOnTokens.radiusFull` for pills). Text is set in Inter, as on the web; the package bundles
  it (SIL Open Font License, in `NOTICES`).
- Results carry the "AI generated" label beside the variant, as on the web (EU AI Act
  transparency).
- Screens set semantics labels, headers and live announcements for progress (the web's status
  region), keep 48 px tap targets, and scroll when text is scaled up.

### Analytics

`createTryOnAnalytics` (`package:studio_vaai/analytics.dart`, also exported by `widgets.dart`) is
the web SDK's `createTryOnAnalytics` from `@studio-vaai/core/analytics`: it maps the try-on's events
to studio vaai's analytics catalogue, the same event names and fields as the web, and sends them
to the collector with the shop's public client key, never with the shopper's session.

```dart
final analytics = createTryOnAnalytics(
  clientApiKey: clientApiKey,
  enabled: () => analyticsEnabled,
);

StudioVaaiTryOn(sdk: sdk, productId: productId, analytics: analytics, /* … */);

analytics.entrypointImpression(productId, 'pdp-button'); // the entry point was shown
analytics.cartItemAdded(CommerceAnalyticsEvent(productId: productId, foreignIds: {'size': 'M'}));
analytics.orderPlaced(CommerceAnalyticsEvent(productId: productId, foreignIds: {'size': 'M'}));
analytics.experimentAssigned(true); // the shopper's arm in a try-on experiment
analytics.dispose(); // when the shop no longer needs it
```

- `enabled()` controls collection. It is checked when an event occurs.
- Each request carries a random ID for that event. Analytics omits visitor IDs and device context.
- `baseUrl` defaults to `https://a.studio-vaai.com`.
- Sending is best effort and never throws. `dispose` still sends the events of the same turn, so
  the final events of a try-on that closes with the page arrive, as React's analytics does.
- `TryOnExperience.tryOnEvents` delivers the journey as the web's `sv-try-on-*` events
  (`TryOnExperienceEvent`: the same type names and detail fields); `analytics.observe` takes any
  source of them, for `TryOnExperienceView` or the headless journey.
- `test/analytics_parity_test.dart` checks the requests against the web mapper's for the same
  inputs (`test/analytics_parity/`, generated by `sdks/core-rs/test/analytics-parity.test.ts`).

### Kept sessions

A native app has no cookie jar, so the widgets keep the bearer credential, its session's expiry
and the committed body (ID and photo source, no photo) in the platform's secure storage
([`flutter_secure_storage`](https://pub.dev/packages/flutter_secure_storage)): the Keychain on
iOS and macOS, Keystore-encrypted storage on Android, never plain preferences. Each shop (API URL
and client key) has its own entry. On the next launch the core verifies the credential with the
API and reads the body back, the same restore the web runs for its cookie.

Beside it, as the web keeps them in local storage, the widgets keep the IDs of the body's latest
try-ons (at most 24, per API and shop; the try-on, product and variant IDs and the body revision,
never an image or a link). A launch that restores the body reads each again through
`GET /try-ons/{id}` for a fresh image link and hands them to the core's restore: the earlier
results, the picker's tried marks and a tried variant's instant result come back. A try-on the
API no longer has is forgotten, a new body replaces the list, and the list is deleted with the
session.

A restored session shows the shopper's person cut-out, the photo the API signs for the body (an
RGBA JPEG XL, decoded by the core where the platform cannot). When the API no longer stores it,
the core restores no body: the flow opens on the photo step and asks for a new photo ("Add a
photo to try this on."), with no error. A renewal that finds the photo deleted drops what the app
holds of it.

The entry is replaced when a refresh rotates the token, and deleted when the session expires, the
API no longer accepts it, the shopper declines consent while it is created, or the flow resets the
session. `keepSession: false` keeps nothing on the device; `sessionStore:` takes your own
`TryOnSessionStore` (`MemoryTryOnSessionStore` for tests). On macOS the Keychain needs the
Keychain Sharing capability (`keychain-access-groups`); without it nothing is kept and each launch
starts a new session. On Android the storage plugin needs `minSdk` 24 or later.

### Devices

`PlatformTryOnDevices` (the default) uses [`image_picker`](https://pub.dev/packages/image_picker)
for the library and [`camera`](https://pub.dev/packages/camera) for the self-timer. Add their
platform setup to your app:

- iOS `Info.plist`: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`.
- Android: `<uses-permission android:name="android.permission.CAMERA"/>`.
- macOS: the camera entitlement and `NSCameraUsageDescription`; the camera plugin has no macOS
  implementation, so the camera screen offers the library there.

Implement `TryOnDevices` to use other plugins. Before upload, a photo is prepared as on the web:
the core's input limits, its camera metadata read from the original, and a downscale and JPEG
re-encode when the core's encoding plan asks for one (`preparePhotoForUpload`). HEIC goes up as
JPEG, decoded by the platform (iOS, macOS, Android 9+); where it cannot be decoded the photo is
refused (`UnsupportedPhotoException`) rather than uploaded as HEIC, which the API does not take.

### Testing your integration

`package:studio_vaai/testing.dart` has `ScriptedApi` (pass it as the `StudioVaai` transport) and
`ScriptedDevices` (pass it as `devices`): the widgets then run the real core with no network,
camera or photo library, as this package's own widget tests do. Pass `imageProvider` to show
result images without the network. `ScriptedApi.fitGate` (`{'M': 'too_small'}`) scripts the fit
gate, `storesPhoto: false` a body whose photo the API no longer stores, and it reads its try-ons
back, so a kept session brings them back on the next launch.

## Headless

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
time an app builds for that target, and checks it against the SHA-256 that
`lib/src/native/prebuilt.json` in the published package pins: it never bundles other bytes. It keeps the download in the app's
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
      prebuilt_base_url: https://artifacts.example.com/studio_vaai/0.1.1/
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
flutter pub get
flutter test                   # the real core against ScriptedApi: journey, widgets, goldens
(cd example && flutter test)   # the example's try-on and headless session
```

`test/widgets_test.dart` taps through every screen state, `test/parity_test.dart` the web
try-on's flow and state behaviours (fit score opt-in, fit gate, tried marks, relaunch); `test/goldens_test.dart` compares every
state in English/light and German/dark, and the main screens in the other two, with
`test/goldens/` (regenerate with
`flutter test --update-goldens test/goldens_test.dart`; the goldens are rendered on macOS).
`test/live_test.dart` runs the widgets against a real API when given a client key and a photo
(see its header). The example's `integration_test/try_on_test.dart` runs the whole try-on on a
device.

`just dart` builds the pinned generator first (see `../core-rs/patches/uniffi-dart`). After a
change to the core's dependencies, `tool/notices.py` rewrites [NOTICES](NOTICES) (`just ci` in
`../core-rs` checks it).

## Releases

The SDK repository's `Flutter` workflow (`.github/workflows/flutter.yml`) builds the package on
every change and, for a tag `studio_vaai-v<version>`, releases it:

1. `tool/build_core.sh` builds the core for each target: Android on Linux with the NDK, Apple on
   macOS with Xcode.
2. `just dart` generates the bindings; `tool/prebuilt_manifest.dart` writes
   `lib/src/native/prebuilt.json` (file names, sizes and SHA-256 of exactly these libraries, and
   the tag's download URL). pub.dev accepts no file under `hook/` but its entry points
   (`build.dart`, `link.dart`), so the hook's own code and the manifest live in
   `lib/src/native/`, which no public library imports.
3. `flutter pub publish --dry-run` validates the package, and `--to-archive` packs it (the
   workflow checks that `hook/` in the archive holds only those entry points). The packed
   package runs its tests on macOS with no core sources, so its hook downloads the library, from
   the workflow's files.
4. On the tag only: a GitHub release with the libraries, the manifest, their SBOMs and the
   package archive, with build provenance attestations; then the archive is published to pub.dev.

Bump `version` in `pubspec.yaml` and add its `CHANGELOG.md` entry first.

pub.dev publishes from GitHub Actions only for a package that exists, so the first version goes
up by hand, from the tag's release: unpack its `studio_vaai-<version>.tar.gz` into an empty
folder and, in that folder (pub needs a `pubspec.yaml` where it runs),
`flutter pub publish --from-archive=path/to/studio_vaai-<version>.tar.gz` (the archive the
workflow tested; `--from-archive` publishes it unchanged). Then, in the
package's admin page on pub.dev, move it to the `studio-vaai.com` verified publisher and enable
automated publishing from this repository with the tag pattern `studio_vaai-v{{version}}` and the
environment `pub.dev`; set the repository variable `PUB_DEV_AUTOMATED_PUBLISHING` to `true`, and
later tags publish themselves.

## License

MIT. See [LICENSE](LICENSE).
