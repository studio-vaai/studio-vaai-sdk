// The ready-made widgets against the real API, end to end: skipped unless a
// client key and a full-body photo are given.
//
//   flutter test test/live_test.dart \
//     --dart-define=STUDIO_VAAI_CLIENT_API_KEY=sv_client_... \
//     --dart-define=STUDIO_VAAI_BASE_URL=https://api.studio-vaai.com \
//     --dart-define=STUDIO_VAAI_PRODUCT_ID=... \
//     --dart-define=STUDIO_VAAI_PHOTO=/path/to/full-body-photo.png
//
// Optionally --dart-define=TRY_ON_SHOTS=<dir> writes the result screen there.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';

import 'support/describe.dart';
import 'support/harness.dart';

const _key = String.fromEnvironment('STUDIO_VAAI_CLIENT_API_KEY');
const _baseUrl = String.fromEnvironment(
  'STUDIO_VAAI_BASE_URL',
  defaultValue: StudioVaai.defaultBaseUrl,
);
const _productId = String.fromEnvironment('STUDIO_VAAI_PRODUCT_ID');
const _photo = String.fromEnvironment('STUDIO_VAAI_PHOTO');
const _shots = String.fromEnvironment('TRY_ON_SHOTS');

/// The test binding answers every HTTP request with 400; this restores the
/// real client for the API and the result images.
final class _RealHttp extends HttpOverrides {}

void main() {
  setUpAll(loadFonts);

  testWidgets('photo, height and a try-on against the API', skip: _key.isEmpty || _photo.isEmpty, (
    tester,
  ) async {
    await HttpOverrides.runWithHttpOverrides(() async {
      final sdk = StudioVaai(
        clientApiKey: _key,
        baseUrl: _baseUrl,
        clientName: 'studio-vaai-flutter-test',
      );
      addTearDown(sdk.dispose);
      final devices = ScriptedDevices(
        photo: File(_photo).readAsBytesSync(),
        mimeType: _photo.endsWith('.png') ? 'image/png' : 'image/jpeg',
      );
      final controller = StudioVaaiTryOnController();
      final events = <ExperienceEvent>[];
      final errors = <Object>[];
      tester.view.physicalSize = const Size(390, 844) * 2;
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        RepaintBoundary(
          key: Harness.shotKey,
          child: MaterialApp(
            home: Scaffold(
              body: StudioVaaiTryOn(
                sdk: sdk,
                productId: _productId,
                productName: 'Live product',
                presentProduct: (details) => simpleProductPresentation(
                  details,
                  roles: {'size': AxisRole.size, 'colorway': AxisRole.color},
                ),
                controller: controller,
                devices: devices,
                onEvent: events.add,
                onError: errors.add,
                onAddToCart: (_) async {},
              ),
            ),
          ),
        ),
      );
      Future<void> wait(bool Function() done, String what, {int seconds = 60}) async {
        final end = DateTime.now().add(Duration(seconds: seconds));
        while (!done() && DateTime.now().isBefore(end)) {
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
          await tester.pump(const Duration(milliseconds: 50));
        }
        final view = controller.experience?.view;
        expect(done(), isTrue, reason: '$what; ${view == null ? '' : describe(view)}; $errors');
      }

      await wait(() => controller.ready, 'product ready');
      expect(controller.open(), isTrue);
      FlowView view() => controller.experience!.view;
      await wait(() => view().domain.session != SessionPhase.restoring, 'session restored');
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
      final messages = TryOnMessages('en');
      addTearDown(messages.dispose);
      await tester.tap(find.text(messages.text('sessionIntro.consentLegal')));
      await tester.pump();
      await tester.tap(find.text(messages.text('sessionIntro.primaryCtaPhoto')).last);
      await wait(() => view().screen is HeightScreenView, 'height', seconds: 120);
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.text(messages.text('heightSetting.confirm')));
      await wait(() => view().screen is TryOnScreenView, 'try-on screen');
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.byKey(const ValueKey('try-on-primary')));
      await wait(() => view().journey.presented, 'presented', seconds: 240);
      await wait(() => view().renderMedia?.result?.phase == ImagePhase.ready, 'image ready');
      await tester.pump(const Duration(seconds: 1));
      expect(errors, isEmpty);
      expect(events.map((e) => e.fact), contains(isA<TryOnRenderedExperienceFact>()));
      if (_shots.isNotEmpty) {
        final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(Harness.shotKey));
        await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 2);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          File('$_shots/live-result.png').writeAsBytesSync(bytes!.buffer.asUint8List());
        });
      }
      controller.close();
      await tester.pumpWidget(const SizedBox());
      // Request deadlines started in the test's fake time: let them lapse.
      await tester.pump(const Duration(minutes: 10));
    }, _RealHttp());
  }, timeout: const Timeout(Duration(minutes: 8)));
}
