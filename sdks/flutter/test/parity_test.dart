// The web try-on's flow and state behaviours, on the ready-made widgets: the
// fit score opt-in, the fit gate's note and the size it offers, the picker's
// labels and tried marks, tried variants shown at once, results and the photo
// after a relaunch, and actions at one height on every step. The real core
// against ScriptedApi, as the other widget tests.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';
import 'package:studio_vaai/src/ui/components.dart';
import 'package:studio_vaai/src/ui/scope.dart';
import 'package:studio_vaai/src/ui/try_on_view.dart' show VariantPicker, isLightSwatch;

import 'support/describe.dart';
import 'support/harness.dart';
import 'support/scenarios.dart';

void main() {
  late Harness h;

  setUpAll(loadFonts);
  setUp(() => h = Harness());
  tearDown(() => h.dispose());

  Future<void> finish(WidgetTester tester) async {
    h.controller.close();
    await tester.pump(const Duration(seconds: 1));
    expect(h.errors, isEmpty);
  }

  TryOnScreenView tryOnScreen() => experienceOf(h).view.screen as TryOnScreenView;

  /// A result of the selected variant, through the scripted try-on route.
  Future<void> tryOnSelection(WidgetTester tester) async {
    final before = experienceOf(h).view.domain.tryOns.length;
    await tapPrimary(tester);
    await settleView(
      tester,
      h,
      (v) => v.domain.tryOns.length > before && v.journey.presented && v.presence.open,
    );
  }

  Finder chip(String label) =>
      find.descendant(of: find.byType(VariantPicker), matching: text(label));

  String sizeNote(String key, String requested, String recommended) =>
      h.m(key, {'requestedSize': requested, 'recommendedSize': recommended});

  group('fit score', () {
    testWidgets('is off by default: no score, no callouts', (tester) async {
      h.fitScore = false;
      scriptFit(h.api);
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await settleView(tester, h, (v) => tryOnScreen().selection.recommendedVariantId != null);
      await tryOnSelection(tester);
      await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
      expect(find.textContaining('%'), findsNothing);
      expect(text(h.m('tryOnView.fitAxisNames.chest')), findsNothing);
      // The size recommendation still works.
      expect(tryOnScreen().selection.recommendedVariantId, ScriptedApi.variantM);
      await finish(tester);
    });
  });

  group('fit gate', () {
    testWidgets('a host size the gate refuses moves to the next that fits, with a quiet note', (
      tester,
    ) async {
      h.api.fitGate['M'] = 'too_small';
      h.chosenAxes = ['size'];
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await settleView(tester, h, (v) => tryOnScreen().presentation.gateSwitch != null);
      final screen = tryOnScreen();
      expect(screen.selection.variantId, ScriptedApi.variantL, reason: 'moved to L');
      final note = sizeNote('sizeAndStyleSelection.garmentTooSmallNote', 'M', 'L');
      expect(note, 'Size M is too small. Try size L.');
      await settleFor(tester, text(note));
      // The note takes the recommendation's place, in its slot of fixed height.
      expect(textContaining('Recommended'), findsNothing);
      expect(
        tester.getSize(find.byKey(const ValueKey('try-on-size-badge-slot'))).height,
        VariantPicker.badgeSlotHeight,
      );
      // Quiet: muted text, not the destructive color, and no error message.
      final style = tester.widget<Text>(text(note)).style!;
      final scope = TryOnScope.of(tester.element(text(note)));
      expect(style.color, scope.tokens.mutedForeground);
      expect(find.byIcon(Icons.error_outline), findsNothing);
      // Narrow, the slot sits on its own line under "Size: L".
      final label = tester.getRect(text('Size: L'));
      final slot = tester.getRect(find.byKey(const ValueKey('try-on-size-badge-slot')));
      expect(slot.top, greaterThanOrEqualTo(label.bottom));
      expect(text('Try on L'), findsOneWidget);
      expect(primaryEnabled(tester), isTrue);
      // The refused M keeps the same bubble as the other sizes: muted, struck-through text.
      final bubble = tester.widget<Container>(
        find.ancestor(of: chip('M'), matching: find.byType(Container)).first,
      );
      expect((bubble.decoration! as BoxDecoration).color, scope.tokens.background);
      final mText = tester.widget<Text>(chip('M')).style!;
      expect(mText.color, scope.tokens.mutedForeground);
      expect(mText.decoration, TextDecoration.lineThrough);
      await finish(tester);
    });

    testWidgets('a refused size the shopper picks stays; the button offers the next', (
      tester,
    ) async {
      h.api.fitGate['M'] = 'too_small';
      h.chosenAxes = ['size'];
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await settleView(tester, h, (v) => tryOnScreen().presentation.gateSwitch != null);
      await tester.tap(chip('M'));
      await tester.pump();
      await settleView(
        tester,
        h,
        (v) => tryOnScreen().presentation.primaryAction is TryNextFittingPrimaryTryOnAction,
      );
      expect(tryOnScreen().selection.variantId, ScriptedApi.variantM);
      await settleFor(
        tester,
        text(sizeNote('sizeAndStyleSelection.garmentTooSmallNote', 'M', 'L')),
      );
      expect(text('Try on L'), findsOneWidget);
      expect(primaryEnabled(tester), isTrue);
      await tryOnSelection(tester);
      expect(experienceOf(h).view.domain.tryOns.single.key.variantId, ScriptedApi.variantL);
      expect(h.api.sent('POST /products/${ScriptedApi.productId}/try-on'), hasLength(1));
      await finish(tester);
    });

    testWidgets('with no size left in that direction the button stays closed', (tester) async {
      h.api.fitGate['M'] = 'too_large';
      h.chosenAxes = ['size'];
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      final note = h.m('sizeAndStyleSelection.garmentTooLargeNoAlternativeNote', {
        'requestedSize': 'M',
      });
      await settleFor(tester, text(note));
      expect(tryOnScreen().selection.variantId, ScriptedApi.variantM);
      expect(tryOnScreen().presentation.primaryAction, isA<UnavailablePrimaryTryOnAction>());
      expect(primaryEnabled(tester), isFalse);
      // Too long for the slot: one line, its whole text for screen readers.
      final semantics = tester.ensureSemantics();
      await tester.pump();
      // The whole note, as written (MF2 isolates the size label with bidi marks).
      expect(
        find.bySemanticsLabel(RegExp(r"doesn't come any smaller\. We can't create")),
        findsOne,
      );
      semantics.dispose();
      await finish(tester);
    });
  });

  group('picker', () {
    testWidgets(
      'one heading open or collapsed; rows reach the card edges; the bag names the size',
      (tester) async {
        await start(tester, h);
        await scenarios['selection']!(tester, h);
        final heading = h.m('tryOnView.pickerHeading', {
          'hasResult': 'yes',
          'hasSize': 'yes',
          'hasColor': 'no',
        });
        expect(heading, 'Try another size');
        // The open picker's row spans the glass card, its choices inset as the label.
        final row = tester.getRect(find.byKey(const ValueKey('try-on-picker-row-size')));
        final card = tester.getRect(
          find.ancestor(of: find.byType(VariantPicker), matching: find.byType(TryOnGlass)),
        );
        // Edge to edge inside the card's 1 px border.
        expect(row.left, card.left + 1);
        expect(row.right, card.right - 1);
        expect(tester.getRect(chip('M')).left, greaterThanOrEqualTo(card.left + 12));
        await tryOnSelection(tester);
        // Collapsed over the result, the button reads as the open picker's heading.
        expect(text(heading), findsOneWidget);
        expect(text(h.m('tryOnView.variantPickerGenericTitle')), findsNothing);
        expect(textContaining('Add M to bag'), findsOneWidget);
        await tapPrimary(tester);
        await settleFor(tester, chip('L'));
        expect(text(heading), findsOneWidget);
        await finish(tester);
      },
    );

    test('light swatches get an outline', () {
      expect(isLightSwatch(const Color(0xFFFFFFFF)), isTrue);
      expect(isLightSwatch(const Color(0xFFF5F5F0)), isTrue);
      expect(isLightSwatch(const Color(0xFF1F2A44)), isFalse);
    });

    testWidgets('rows the shop does not name are headed "Size: M"', (tester) async {
      h.sizeAxisLabel = null;
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      expect(text(h.m('tryOnView.sizeAxisLabel', {'hasSize': 'yes', 'sizeLabel': 'M'})), findsOne);
      expect(text('Size: M'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('tried marks, and a tried variant shown at once without a request', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      // Nothing tried yet: no mark on the selected chip.
      expect(find.byKey(const ValueKey('option-mark-current')), findsNothing);
      await tryOnSelection(tester);
      // The result's picker: the selected, tried M wears the dark mark.
      await tapPrimary(tester);
      await settleFor(tester, chip('L'));
      expect(find.byKey(const ValueKey('option-mark-current')), findsOneWidget);
      expect(find.byKey(const ValueKey('option-mark-tried')), findsNothing);
      // Choosing L, untried: the picture stays, the button offers L.
      await tester.tap(chip('L'));
      await tester.pump();
      await settleFor(tester, text('Try on L'));
      expect(find.byKey(const ValueKey('option-mark-tried')), findsOneWidget, reason: 'M tried');
      expect(find.byKey(const ValueKey('option-mark-current')), findsNothing);
      final requests = h.api.sent('POST /products/${ScriptedApi.productId}/try-on').length;
      // Back to M: its result at once, no request, "You're wearing M".
      await tester.tap(chip('M'));
      await tester.pump();
      await settleFor(tester, text('You’re wearing M'));
      final displayed = tryOnScreen().presentation.displayed;
      expect(displayed, isA<TryOnDisplayedImage>(), reason: describe(experienceOf(h).view));
      expect(h.api.sent('POST /products/${ScriptedApi.productId}/try-on'), hasLength(requests));
      await finish(tester);
    });
  });

  group('relaunch', () {
    Future<void> relaunch(WidgetTester tester) async {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      await start(tester, h);
    }

    /// The try-on IDs the device keeps.
    List<String> keptIds() => [
      for (final MapEntry(:key, :value) in h.sessionStore.values.entries)
        if (key.startsWith('sv.tryOn.history.'))
          for (final t in (jsonDecode(value) as Map)['tryOns'] as List)
            (t as Map)['tryOnId'] as String,
    ];

    testWidgets('offline, keeps the earlier try-ons for the next launch', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tryOnSelection(tester);
      final made = experienceOf(h).view.domain.tryOns.single;
      // The relaunch cannot read the try-on again: no network, then a busy API.
      for (final answer in <FutureOr<HttpResponse> Function(HttpRequest)>[
        (_) => throw const SocketException('offline'),
        (_) => ScriptedApi.problem(503, 'unavailable'),
      ]) {
        h.api.overrides['GET /try-ons/${made.id}'] = answer;
        await relaunch(tester);
        await settleView(tester, h, (v) => v.screen is TryOnScreenView);
        await settle(tester, () => h.api.sent('GET /try-ons/${made.id}').isNotEmpty);
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
        expect(experienceOf(h).view.domain.tryOns, isEmpty);
        expect(keptIds(), [made.id], reason: 'kept for the next launch');
        h.api.requests.clear();
      }
      // Back online: the next launch brings it back.
      h.api.overrides.remove('GET /try-ons/${made.id}');
      await relaunch(tester);
      await settleView(tester, h, (v) => v.domain.tryOns.isNotEmpty);
      expect(experienceOf(h).view.domain.tryOns.single.id, made.id);
      await finish(tester);
    });

    testWidgets('forgets a try-on the API no longer has', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tryOnSelection(tester);
      final made = experienceOf(h).view.domain.tryOns.single;
      h.api.overrides['GET /try-ons/${made.id}'] = (_) => ScriptedApi.problem(404, 'not-found');
      await relaunch(tester);
      await settleView(tester, h, (v) => v.screen is TryOnScreenView);
      await settle(tester, () => keptIds().isEmpty);
      expect(keptIds(), isEmpty);
      expect(experienceOf(h).view.domain.tryOns, isEmpty);
      await finish(tester);
    });

    testWidgets('brings back the earlier try-ons, keeping only their IDs', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tryOnSelection(tester);
      final made = experienceOf(h).view.domain.tryOns.single;
      await relaunch(tester);
      await settleView(tester, h, (v) => v.domain.tryOns.isNotEmpty);
      expect(experienceOf(h).view.domain.tryOns.single.id, made.id);
      // Read again for a fresh link, not made again.
      expect(h.api.sent('GET /try-ons/${made.id}'), hasLength(1));
      expect(h.api.sent('POST /products/${ScriptedApi.productId}/try-on'), hasLength(1));
      // The device keeps IDs only: no image and no link.
      for (final value in h.sessionStore.values.values) {
        expect(value, isNot(contains('http')));
      }
      // Its mark and its instant result are back.
      await settleView(tester, h, (v) => v.screen is TryOnScreenView);
      await settleFor(tester, find.byKey(const ValueKey('option-mark-current')));
      // The selected size's restored result shows at once, without a request.
      await settleView(
        tester,
        h,
        (v) => tryOnScreen().presentation.displayed is TryOnDisplayedImage,
      );
      expect(textContaining('wearing M'), findsOneWidget);
      expect(h.api.sent('POST /products/${ScriptedApi.productId}/try-on'), hasLength(1));
      await finish(tester);
    });

    testWidgets('without a stored photo, asks for one: no empty box, no error', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tryOnSelection(tester);
      // The API's retention deletes the person cut-out.
      h.api.storesPhoto = false;
      await relaunch(tester);
      await settleFor(tester, text(h.m('experience.addPhotoToTryOn')));
      final view = experienceOf(h).view;
      expect(view.screen, isA<IntroductionScreenView>(), reason: describe(view));
      expect(view.domain.photo, isNull);
      expect(find.byIcon(Icons.error_outline), findsNothing);
      expect(textContaining('could not be loaded'), findsNothing);
      // Its try-on IDs are forgotten with the body.
      expect(h.sessionStore.values.keys.where((k) => k.contains('history')), isEmpty);
      await finish(tester);
    });
  });

  group('a lost try-on response', () {
    for (final (name, answer) in [
      ('a gateway timeout', (HttpRequest _) => ScriptedApi.problem(504, 'gateway-timeout')),
      ('a network error', (HttpRequest _) => throw const SocketException('connection reset')),
    ]) {
      testWidgets('after $name offers the retry and keeps the photo', (tester) async {
        await start(tester, h);
        await scenarios['selection']!(tester, h);
        final route = 'POST /products/${ScriptedApi.productId}/try-on';
        h.api.overrides[route] = answer;
        await tapPrimary(tester);
        await settleView(
          tester,
          h,
          (v) => tryOnScreen().presentation.primaryAction is RetryPrimaryTryOnAction,
        );
        final view = experienceOf(h).view;
        expect(view.domain.photo, isNotNull, reason: describe(view));
        expect(view.screen, isA<TryOnScreenView>());
        expect(textContaining(h.m('experience.photoUncertain')), findsNothing);
        expect(primaryEnabled(tester), isTrue);
        // Trying again creates the try-on, with the attempt's idempotency key:
        // the backend answers with a try-on it may have made, never a second.
        h.api.overrides.remove(route);
        await tryOnSelection(tester);
        String? key(HttpRequest r) => r.headers
            .where((header) => header.name.toLowerCase() == 'idempotency-key')
            .map((header) => header.value)
            .firstOrNull;
        final keys = [for (final r in h.api.sent(route)) key(r)];
        expect(keys, hasLength(2));
        expect(keys.first, matches(RegExp(r'^[0-9a-f-]{36}$')));
        expect(keys.last, keys.first);
        await finish(tester);
      });
    }

    testWidgets('a new attempt after a settled one sends a new idempotency key', (tester) async {
      await start(tester, h);
      await scenarios['selection']!(tester, h);
      await tryOnSelection(tester);
      await tapPrimary(tester);
      await settleFor(tester, chip('L'));
      await tester.tap(chip('L'));
      await tester.pump();
      await tryOnSelection(tester);
      final keys = [
        for (final r in h.api.sent('POST /products/${ScriptedApi.productId}/try-on'))
          r.headers.firstWhere((header) => header.name.toLowerCase() == 'idempotency-key').value,
      ];
      expect(keys, hasLength(2));
      expect(keys.toSet(), hasLength(2));
      await finish(tester);
    });
  });

  testWidgets('a 401 on a try-on ends the session: its data is gone, the intro asks again', (
    tester,
  ) async {
    await start(tester, h);
    await scenarios['selection']!(tester, h);
    await tryOnSelection(tester);
    // A 401 whose body names no session problem the client knows.
    h.api.overrides['POST /products/${ScriptedApi.productId}/try-on'] = (_) =>
        ScriptedApi.problem(401, 'unauthorized');
    await tapPrimary(tester);
    await settleFor(tester, chip('L'));
    await tester.tap(chip('L'));
    await tester.pump();
    await tapPrimary(tester);
    await settleView(tester, h, (v) => v.issue is SessionExpiredIssue);
    final view = experienceOf(h).view;
    expect(view.screen, isA<IntroductionScreenView>(), reason: describe(view));
    expect(view.domain.session, SessionPhase.absent);
    expect(view.domain.photo, isNull);
    expect(view.domain.tryOns, isEmpty);
    await settleFor(tester, text(h.m('experience.sessionExpired')));
    // Nothing of the session stays on the device: credential, body, try-on IDs.
    expect(h.sessionStore.values, isEmpty);
    // Starting again takes consent and a new photo.
    expect(text(h.m('sessionIntro.consentLegal')), findsOneWidget);
    await finish(tester);
  });

  testWidgets('a long German subtitle wraps to two lines instead of an ellipsis', (tester) async {
    await start(tester, h, locale: 'de', size: const Size(360, 780));
    final subtitle = h.m('sessionIntro.sheetSubtitle');
    final paragraph = tester.renderObject<RenderParagraph>(
      find.descendant(of: text(subtitle), matching: find.byType(RichText)),
    );
    expect(paragraph.didExceedMaxLines, isFalse);
    expect(paragraph.size.height, greaterThan(14 * 1.4 * 1.5), reason: 'two lines');
    await finish(tester);
  });

  testWidgets('the download control stays while it works, with a spinner after a moment', (
    tester,
  ) async {
    await start(tester, h);
    await scenarios['result-fit-unavailable']!(tester, h);
    h.gate.hold('GET /try-on-1.webp');
    await tester.tap(find.byKey(const ValueKey('try-on-download')));
    await tester.pump();
    await settleView(tester, h, (v) => v.renderMedia?.download.pending == true);
    expect(find.byKey(const ValueKey('try-on-download')), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 200));
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('try-on-download-busy')),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );
    h.gate.release('GET /try-on-1.webp');
    await settleView(tester, h, (v) => v.renderMedia?.download.pending == false);
    expect(find.byKey(const ValueKey('try-on-download')), findsOneWidget);
    await finish(tester);
  });

  testWidgets('the actions sit at one height on every step', (tester) async {
    await start(tester, h);
    Rect primary() => tester.getRect(find.byKey(const ValueKey('try-on-primary')));
    final intro = primary();
    await scenarios['height']!(tester, h);
    expect(primary(), intro, reason: 'height');
    await tapText(tester, h.m('heightSetting.confirm'));
    await settleFor(tester, text(h.m('sizeAndStyleSelection.variantSubtitle')));
    expect(primary(), intro, reason: 'selection');
    await tryOnSelection(tester);
    await settleFor(tester, textContaining(h.m('tryOnView.aiGeneratedLabel')));
    expect(primary(), intro, reason: 'result');
    await finish(tester);
  });

  testWidgets(
    'the actions stay at the bottom: open disclosures scroll, a lone primary keeps its place',
    (tester) async {
      await start(tester, h);
      Rect primary() => tester.getRect(find.byKey(const ValueKey('try-on-primary')));
      final intro = primary();
      // The photo facts and the withdrawal text open: the content scrolls above
      // the buttons, which stay where they were, the secondary on screen.
      await tapText(tester, h.m('sessionIntro.photoFactsTitle'));
      await tapText(tester, h.m('sessionIntro.withdrawalDisclosureLabel'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(primary(), intro);
      final secondary = tester.getRect(text(h.m('sessionIntro.secondaryCtaCamera')));
      expect(secondary.bottom, lessThanOrEqualTo(844));
      // A screen without a secondary action (a failed upload) keeps its slot.
      h.api.overrides['POST /bodies'] = (_) => ScriptedApi.problem(400, 'invalid-request');
      await giveConsent(tester, h);
      await tapPrimary(tester);
      await settleView(
        tester,
        h,
        (v) => v.journey.photoUpload?.phase == PhotoUploadPhase.invalidPhoto,
      );
      expect(primary(), intro);
      await finish(tester);
    },
  );

  testWidgets('buttons take the button radius token', (tester) async {
    final messages = TryOnMessages('en');
    addTearDown(messages.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: TryOnScope(
          messages: messages,
          tokens: TryOnTokens.light.copyWith(buttonRadius: TryOnTokens.radiusFull),
          appearance: TryOnAppearance.light,
          imageProvider: (_) => MemoryImage(resultPhoto),
          child: const Material(child: TryOnButton(label: 'Try on')),
        ),
      ),
    );
    final material = tester.widget<Material>(
      find.descendant(of: find.byType(TryOnButton), matching: find.byType(Material)),
    );
    expect(material.borderRadius, BorderRadius.circular(TryOnTokens.radiusFull));
    expect(TryOnTokens.light.buttonRadius, TryOnTokens.radius);
  });
}
