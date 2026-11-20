# studio_vaai example

One try-on session in a Flutter app (Android, iOS, macOS): start a session, show a product, upload a photo, set the
height, and show the try-on.

Without a client API key, the app runs against `ScriptedApi` (`package:studio_vaai/testing.dart`)
in process. With one, it calls the API:

```sh
flutter run -d macos \
  --dart-define=STUDIO_VAAI_CLIENT_API_KEY=sv_client_... \
  --dart-define=STUDIO_VAAI_BASE_URL=https://api.studio-vaai.com \
  --dart-define=STUDIO_VAAI_PRODUCT_ID=<product ID> \
  --dart-define=STUDIO_VAAI_PHOTO=/path/to/full-body-photo.jpg \
  --dart-define=STUDIO_VAAI_HEIGHT_CM=175
```

On Android, the same defines work with `flutter run -d <device>` or `flutter build apk`; building
needs the Android NDK (the package's build hook links the core with its clang). Without
`STUDIO_VAAI_PHOTO` the app uploads a blank image, which the API rejects as having no person in it:
enough to check the session and the upload on a device.

The macOS app runs outside the App Sandbox so that it can read the photo at `STUDIO_VAAI_PHOTO`;
an app would keep the sandbox and read a photo the shopper picked.

Tests:

- `flutter test` runs the session in the Flutter test engine on the host, on the real core.
- `flutter test integration_test -d <device>` runs it in the app on a device (Android, or macOS
  with Xcode). With a client API key defined, `integration_test/live_session_test.dart` runs the
  session against the API there too.
