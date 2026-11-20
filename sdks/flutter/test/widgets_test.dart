// The ready-made widgets on the real core, against ScriptedApi and scripted
// devices: every screen state the flow shows, reached by tapping as a
// shopper would. No core logic is mocked.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';

import 'package:studio_vaai/src/ui/pinch_zoom.dart';

import 'support/describe.dart';
import 'support/harness.dart';
import 'support/scenarios.dart';

void main() {
  late Harness h;

  setUpAll(loadFonts);
  setUp(() => h = Harness());
  tearDown(() => h.dispose());

  /// Closes the flow at the end of a test, so no route or timer outlives it.
  Future<void> finish(WidgetTester tester) async {
    h.controller.close();
    await tester.pump(const Duration(seconds: 1));
    expect(h.errors, isEmpty);
  }

  group('host widget', () {
    testWidgets('is ready once the product is installed; open and close follow the flow', (
      tester,
    ) async {
      final ready = <bool>[];
      await tester.pumpWidget(h.app());
      expect(h.controller.ready, isFalse);
      expect(h.controller.open(), isFalse);
      h.controller.addListener(() => ready.add(h.controller.ready));
      await settle(tester, () => h.controller.ready, reason: 'ready');
      expect(ready, [true]);
      expect(text('Product page'), findsOneWidget);

      expect(h.controller.open(), isTrue);
      await settle(tester, () => find.byType(TryOnFlowView).evaluate().isNotEmpty);
      expect(text(h.m('sessionIntro.sheetTitle')), findsOneWidget);
      expect(
        h.events.map((e) => e.fact).whereType<JourneyExperienceFact>().map((f) => f.event),
        contains(isA<OpenedJourneyEvent>()),
      );

      // Close in the header closes the route and the flow.
      await tester.tap(find.byTooltip(h.m('surface.closeSr')));
      await settle(tester, () => find.byType(TryOnFlowView).evaluate().isEmpty);
      expect(experienceOf(h).view.presence.open, isFalse);
      expect(h.errors, isEmpty);
    });

    testWidgets('the system back gesture is the flow’s Back, and closes at the start', (
      tester,
    ) async {
      await start(tester, h);
      await scenarios['height']!(tester, h);
      expect(experienceOf(h).view.canGoBack, isTrue);
      await tester.binding.handlePopRoute();
      await settleView(tester, h, (v) => v.screen is IntroductionScreenView);
      await tester.binding.handlePopRoute();
      await settle(tester, () => find.byType(TryOnFlowView).evaluate().isEmpty);
      expect(experienceOf(h).view.presence.open, isFalse);
      await finish(tester);
    });

    testWidgets('a new product installs in the same session; rebuilds do not reinstall', (
      tester,
    ) async {
      h.api.overrides['GET /products/by-foreign-id/shirt-1'] = (request) => ScriptedApi.json(200, {
        'productId': ScriptedApi.productId,
        'variants': [
          {
            'id': ScriptedApi.variantM,
            'foreignVariantIds': {'size': 'M'},
          },
          {
            'id': ScriptedApi.variantL,
            'foreignVariantIds': {'size': 'L'},
          },
        ],
      });
      await tester.pumpWidget(h.app());
      await settle(tester, () => h.controller.ready, reason: 'ready');
      final experience = experienceOf(h);
      // A rebuild with a new presentProduct closure keeps the installation.
      await tester.pumpWidget(h.app());
      expect(h.controller.ready, isTrue);
      expect(h.api.sent('GET /products/${ScriptedApi.productId}'), hasLength(1));

      await tester.pumpWidget(h.app(foreignId: 'shirt-1'));
      await settle(
        tester,
        () => h.api.sent('GET /products/by-foreign-id/shirt-1').isNotEmpty && h.controller.ready,
        reason: 'reinstalled',
      );
      expect(identical(experienceOf(h), experience), isTrue);
      await finish(tester);
    });

    testWidgets('a relaunch restores the session and shows the photo from the API', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      expect(h.sessionStore.values, isNotEmpty);
      // The app ends; a new launch keeps only the stored session.
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      await start(tester, h);
      await settleView(tester, h, (v) => v.screen is TryOnScreenView);
      final view = experienceOf(h).view;
      expect(view.domain.photo?.source, PhotoSource.library_);
      expect(h.api.sent('POST /bodies'), hasLength(1));
      await settle(
        tester,
        () => experienceOf(h).view.renderMedia?.source?.phase != ImagePhase.loading,
      );
      expect(
        textContaining('could not be loaded'),
        findsNothing,
        reason: describe(experienceOf(h).view),
      );
      await finish(tester);
    });

    testWidgets('reopening keeps the shopper’s photo and height', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      h.controller.close();
      await settle(tester, () => find.byType(TryOnFlowView).evaluate().isEmpty);
      expect(h.controller.open(), isTrue);
      await settle(tester, () => find.byType(TryOnFlowView).evaluate().isNotEmpty);
      expect(experienceOf(h).view.domain.photo, isNotNull);
      await finish(tester);
    });
  });

  group('introduction', () {
    testWidgets('consent, disclosures, legal copy and the photo guide', (tester) async {
      await start(tester, h);
      expect(text(h.m('sessionIntro.sheetTitle')), findsOneWidget);
      expect(text(h.m('sessionIntro.sheetSubtitle')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('Full body')), findsOneWidget);
      expect(find.bySemanticsLabel('powered by studio vaai'), findsOneWidget);
      expect(find.textContaining('Terms and Conditions', findRichText: true), findsOneWidget);
      // At the start there is nothing to go back to.
      expect(find.byTooltip(h.m('surface.backSr')), findsNothing);

      await tapText(tester, h.m('sessionIntro.photoFactsTitle'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(text(h.m('sessionIntro.photoFacts.onlyForTryOn')), findsOneWidget);
      await tapText(tester, h.m('sessionIntro.withdrawalDisclosureLabel'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.textContaining('info@studio-vaai.com', findRichText: true), findsOneWidget);
      await finish(tester);
    });

    testWidgets('without consent the flow asks for it and opens no source', (tester) async {
      await start(tester, h);
      await scenarios['intro-validation']!(tester, h);
      expect(h.devices.picks, 0);
      expect(experienceOf(h).view.issue, isA<ConsentRequiredIssue>());
      await giveConsent(tester, h);
      await settle(tester, () => text(h.m('sessionIntro.consentRequired')).evaluate().isEmpty);
      expect(text(h.m('sessionIntro.consentRequired')), findsNothing);
      await finish(tester);
    });

    testWidgets('a picker that fails shows its message; a cancelled one returns', (tester) async {
      h.devices.pickerFailure = DeviceException.failed;
      await start(tester, h);
      await giveConsent(tester, h);
      await tapText(tester, h.m('sessionIntro.primaryCtaPhoto'));
      await settleFor(tester, text(h.m('experience.pickerFailed')));
      h.devices
        ..pickerFailure = null
        ..cancelPicker = true;
      await tapText(tester, h.m('sessionIntro.primaryCtaPhoto'));
      await settle(tester, () => h.devices.picks == 2);
      await settleView(tester, h, (v) => v.modal == null && v.screen is IntroductionScreenView);
      await finish(tester);
    });
  });

  group('photo', () {
    testWidgets('processing shows the photo and announces progress', (tester) async {
      final semantics = tester.ensureSemantics();
      await start(tester, h);
      await scenarios['photo-processing']!(tester, h);
      expect(find.bySemanticsLabel(h.m('photo.previewAlt')), findsWidgets);
      expect(find.bySemanticsLabel(h.m('experience.processingPhoto')), findsWidgets);
      h.gate.release('POST /bodies');
      await settleFor(tester, text(h.m('heightSetting.title')));
      semantics.dispose();
      await finish(tester);
    });

    testWidgets('a rejected photo says why; the guide returns to the start', (tester) async {
      await start(tester, h);
      await scenarios['photo-rejected']!(tester, h);
      expect(text(h.m('bodyFailure.feetNotVisible')), findsOneWidget);
      expect(find.bySemanticsLabel(h.m('photo.rejectedAlt')), findsOneWidget);

      await tapText(tester, h.m('photoUpload.guideLink'));
      await settleFor(tester, text(h.m('sessionIntro.sheetTitle')));

      h.api.overrides.remove('POST /bodies');
      await tapText(tester, h.m('sessionIntro.primaryCtaPhoto'));
      await settleFor(tester, text(h.m('heightSetting.title')));
      await finish(tester);
    });

    testWidgets('a rejected photo is replaced from its own source', (tester) async {
      await start(tester, h);
      await scenarios['photo-rejected']!(tester, h);
      h.api.overrides.remove('POST /bodies');
      await tapText(tester, h.m('photoUpload.primaryRetry'));
      await settleFor(tester, text(h.m('heightSetting.title')));
      expect(h.devices.picks, 2);
      await finish(tester);
    });

    testWidgets('a failed upload offers a way on', (tester) async {
      h.api.overrides['POST /bodies'] = (_) => ScriptedApi.problem(503, 'unavailable');
      await start(tester, h);
      await giveConsent(tester, h);
      await tapText(tester, h.m('sessionIntro.primaryCtaPhoto'));
      await settleFor(tester, text(h.m('experience.photoFailed')));
      h.api.overrides.remove('POST /bodies');
      final retry = text(h.m('experience.retryPhoto'));
      if (retry.evaluate().isNotEmpty) {
        await tapText(tester, h.m('experience.retryPhoto'));
      } else {
        await tapText(tester, h.m('experience.choosePhoto'));
        await settleFor(tester, text(h.m('experience.chooseFromLibrary')));
        await tapText(tester, h.m('experience.chooseFromLibrary'));
      }
      await settleFor(tester, text(h.m('heightSetting.title')));
      await finish(tester);
    });
  });

  group('camera', () {
    testWidgets('live preview, switch camera, self-timer countdown and capture', (tester) async {
      await start(tester, h);
      await scenarios['camera-live']!(tester, h);
      expect(text(h.m('photoCapture.infoBody')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(h.m('photo.cameraPreview'))), findsOneWidget);
      expect(h.devices.opened, 1);

      await tester.tap(find.byTooltip(h.m('photoCapture.switchCameraSr')));
      await tester.pump();
      await settle(
        tester,
        () => h.devices.opened == 2 && h.devices.closed == 1,
        reason: 'switched',
      );

      await tapText(tester, h.m('photoCapture.selfTimerCta', {'seconds': 10}));
      await tester.pump(const Duration(milliseconds: 1200));
      await tester.pump();
      expect(text(h.m('photoCapture.cancelTimerCta')), findsOneWidget);

      // Cancelling stops the timer; starting again and waiting captures.
      await tapText(tester, h.m('photoCapture.cancelTimerCta'));
      await settleFor(tester, text(h.m('photoCapture.selfTimerCta', {'seconds': 10})));
      await tester.pump(const Duration(seconds: 10));
      expect(h.devices.captures, 0);
      await tapText(tester, h.m('photoCapture.selfTimerCta', {'seconds': 10}));
      await tester.pump(const Duration(seconds: 11));
      await settleFor(tester, text(h.m('heightSetting.title')));
      expect(h.devices.captures, 1);
      expect(experienceOf(h).view.domain.photo?.source, PhotoSource.camera);
      await finish(tester);
    });

    testWidgets('denied, missing and failed cameras say so and offer the library', (tester) async {
      await start(tester, h);
      await scenarios['camera-denied']!(tester, h);
      expect(text(h.m('photoCapture.permissionDeniedBodyApp')), findsOneWidget);
      expect(text(h.m('photoCapture.uploadFromLibraryCta')), findsOneWidget);

      h.devices.cameraFailure = DeviceException.unavailable;
      await tapText(tester, h.m('photoCapture.retry'));
      await settleFor(tester, text(h.m('photoCapture.unavailableBody')));

      h.devices.cameraFailure = null;
      await tapText(tester, h.m('photoCapture.retry'));
      await settleView(
        tester,
        h,
        (v) =>
            v.screen is CameraScreenView &&
            (v.screen as CameraScreenView).camera is LiveCameraState,
      );

      await tapText(tester, h.m('photoCapture.uploadFromLibraryCta'));
      await settleFor(tester, text(h.m('heightSetting.title')));
      await finish(tester);
    });

    testWidgets('retaking a camera photo asks first', (tester) async {
      await start(tester, h);
      await scenarios['retake-dialog']!(tester, h);
      expect(text(h.m('photoCapture.retakeBody')), findsOneWidget);
      await tapText(tester, h.m('photoCapture.retakeCancel'));
      await settleView(tester, h, (v) => v.modal == null && v.screen is HeightScreenView);
      await tapText(tester, h.m('heightSetting.useOtherImage'));
      await settleFor(tester, text(h.m('photoCapture.retakeTitle')));
      await tapText(tester, h.m('photoCapture.retakeContinue'));
      await settleView(tester, h, (v) => v.screen is CameraScreenView);
      await finish(tester);
    });
  });

  group('height', () {
    testWidgets('starts at the estimate, steps, corrects typed values and saves', (tester) async {
      await start(tester, h);
      await scenarios['height']!(tester, h);
      expect(heightField('172'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.keyboard_arrow_up));
      await tester.pump();
      await settleFor(tester, heightField('173'));

      await tester.enterText(find.byType(TextField), '250');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      await settleFor(tester, heightField('220'));
      expect(
        text(h.m('heightInput.corrected', {'value': 220, 'min': 140, 'max': 220})),
        findsOneWidget,
        reason: '${texts()}',
      );

      await tapText(tester, h.m('heightSetting.confirm'));
      await settleFor(tester, text(h.m('sizeAndStyleSelection.variantSubtitle')));
      await settle(
        tester,
        () => h.api.sent('PATCH /bodies/${ScriptedApi.bodyId}/height').isNotEmpty,
        reason: 'height saved',
      );
      await finish(tester);
    });
  });

  group('try-on', () {
    testWidgets('generating, a result with the AI label, a second variant, history, bag', (
      tester,
    ) async {
      await start(tester, h);
      await scenarios['generating']!(tester, h);
      expect(text(h.m('tryOnView.busyMessages.0')), findsOneWidget);
      h.gate.release('POST /products/${ScriptedApi.productId}/try-on');
      await settleFor(tester, text('Size M · ${h.m('tryOnView.aiGeneratedLabel')}'));
      await settleView(tester, h, (v) => v.journey.presented);

      // A second variant: the history lists both results.
      await tapPrimary(tester);
      await settleFor(tester, text(h.m('sizeAndStyleSelection.variantSectionLabel')));
      await tapText(tester, 'L');
      await settleView(
        tester,
        h,
        (v) => (v.screen as TryOnScreenView).selection.variantId == ScriptedApi.variantL,
      );
      await tapPrimary(tester);
      await settleFor(tester, text('Size L · ${h.m('tryOnView.aiGeneratedLabel')}'));
      await settleView(tester, h, (v) => v.journey.presented);
      expect(text('M'), findsOneWidget);
      await tapText(tester, 'M');
      await settleFor(tester, text('Size M · ${h.m('tryOnView.aiGeneratedLabel')}'));

      await settleView(tester, h, (v) => v.renderMedia?.cart.available == true);
      await settleFor(tester, text('Add M to bag (€89)'));
      await tapText(tester, 'Add M to bag (€89)');
      await settle(tester, () => h.carts.isNotEmpty, reason: describe(experienceOf(h).view));
      expect(h.carts.single.variantId, ScriptedApi.variantM);
      expect(
        h.events.map((e) => e.fact),
        containsAll([isA<TryOnRenderedExperienceFact>(), isA<AddToCartRequestedExperienceFact>()]),
      );
      await finish(tester);
    });

    testWidgets('a recommended size, the fit score and its callouts on the result', (tester) async {
      await start(tester, h);
      await scenarios['result-fit']!(tester, h);
      expect(text('87%'), findsOneWidget);
      expect(text('Chest'), findsOneWidget);
      expect(text(h.m('tryOnView.fitVerdicts.ideal')), findsOneWidget);
      expect(text(h.m('tryOnView.lengthVerdicts.runsLoose')), findsOneWidget);
      // Collapsing the score hides the callouts.
      await tester.tap(text('87%'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(text('Chest'), findsNothing);
      await finish(tester);
    });

    testWidgets('two fingers zoom the result, lifted over the page, and let go springs back', (
      tester,
    ) async {
      await start(tester, h, pixelRatio: 1);
      await scenarios['result']!(tester, h);
      final image = tester.getRect(find.byType(PinchZoom));
      expect(find.byKey(const ValueKey('try-on-zoom')), findsNothing);
      // Two fingers spreading lift a copy over the page and scale it.
      final (one, two) = await pinchResult(tester);
      final lifted = find.byKey(const ValueKey('try-on-zoom'));
      expect(lifted, findsOneWidget);
      final scaled = tester.getRect(
        find.descendant(of: lifted, matching: find.byType(Image)).first,
      );
      expect(scaled.width, greaterThan(image.width * 1.5));
      await one.up();
      await two.up();
      // Springs back in 420 ms.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 450));
      await tester.pump();
      expect(find.byKey(const ValueKey('try-on-zoom')), findsNothing);
      await finish(tester);
    });

    testWidgets('the result going away mid-pinch drops the lifted copy', (tester) async {
      await start(tester, h, pixelRatio: 1);
      await scenarios['result']!(tester, h);
      final (one, two) = await pinchResult(tester);
      expect(find.byKey(const ValueKey('try-on-zoom')), findsOneWidget);
      // The app replaces the page while both fingers are down.
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const ValueKey('try-on-zoom')), findsNothing);
      await one.up();
      await two.up();
      await tester.pump();
    });

    testWidgets('a failed try-on names the variant and retries', (tester) async {
      h.api.overrides['POST /products/${ScriptedApi.productId}/try-on'] = (_) =>
          ScriptedApi.problem(500, 'internal');
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tapPrimary(tester);
      await settleView(
        tester,
        h,
        (v) => (v.screen as TryOnScreenView).presentation.feedback?.failure != null,
      );
      expect(text(h.m('experience.namedTryOnFailed', {'variant': 'M'})), findsNothing);
      expect(texts().any((t) => t.contains('could not generate')), isTrue, reason: '${texts()}');
      h.api.overrides.remove('POST /products/${ScriptedApi.productId}/try-on');
      await tapPrimary(tester);
      await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
      await finish(tester);
    });

    testWidgets('stock from the host reaches the flow', (tester) async {
      tester.view.physicalSize = const Size(390, 844) * 3;
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        h.app(
          commerce: {ScriptedApi.variantL: const VariantCommerce(price: '€89', inStock: false)},
        ),
      );
      await warmImages(tester);
      await openTryOn(tester, h);
      expect(experienceOf(h).view.domain.unavailableVariants, [ScriptedApi.variantL]);
      await finish(tester);
    });
  });

  group('accessibility', () {
    testWidgets('large text scrolls instead of overflowing', (tester) async {
      await start(tester, h, textScale: 2);
      await scenarios['height']!(tester, h);
      await tapText(tester, h.m('heightSetting.confirm'));
      await settleFor(tester, text(h.m('sizeAndStyleSelection.variantSubtitle')));
      expect(tester.takeException(), isNull);
      await finish(tester);
    });

    testWidgets('headers, buttons and controls carry semantics and tap targets', (tester) async {
      final semantics = tester.ensureSemantics();
      await start(tester, h);
      expect(
        tester.getSemantics(text(h.m('sessionIntro.sheetTitle'))),
        matchesSemantics(label: h.m('sessionIntro.sheetTitle'), isHeader: true),
      );
      expect(find.bySemanticsLabel(h.m('surface.closeSr')), findsOneWidget);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      semantics.dispose();
      await finish(tester);
    });
  });

  testWidgets('German text from the same catalog', (tester) async {
    await start(tester, h, locale: 'de');
    expect(text('Bereit zur Anprobe?'), findsOneWidget);
    expect(text('Foto hochladen'), findsWidgets);
    await finish(tester);
  });

  testWidgets('host message overrides replace catalog text', (tester) async {
    tester.view.physicalSize = const Size(390, 844) * 3;
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(h.app(messages: {'sessionIntro.sheetTitle': 'Try it on at home'}));
    await openTryOn(tester, h);
    expect(text('Try it on at home'), findsOneWidget);
    await finish(tester);
  });
}
