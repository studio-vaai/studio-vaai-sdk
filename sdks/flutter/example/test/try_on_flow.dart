import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';
import 'package:studio_vaai_example/main.dart';

/// Taps through the example's ready-made try-on, as a shopper, on the real
/// core against [ScriptedApi] and [ScriptedDevices].
Future<void> runTryOnFlow(WidgetTester tester) async {
  final m = TryOnMessages('en');
  addTearDown(m.dispose);
  String t(String key, [Map<String, Object> values = const {}]) =>
      m.text(key, values).replaceAll(RegExp('[\u2068\u2069]'), '');
  Finder text(String value) => find.byWidgetPredicate(
    (w) => w is Text && (w.data ?? '').replaceAll(RegExp('[\u2068\u2069]'), '') == value,
    description: 'text "$value"',
  );

  Future<void> until(Finder finder, {int tries = 400}) async {
    for (var i = 0; i < tries && finder.evaluate().isEmpty; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    expect(finder, findsWidgets);
  }

  Future<void> tap(Finder finder) async {
    await tester.ensureVisible(finder.first);
    await tester.pump();
    await tester.tap(finder.first);
    await tester.pump();
  }

  await tester.pumpWidget(ExampleApp(devices: ScriptedDevices(), transport: ScriptedApi()));
  await until(text('Try it on'));
  await tap(text('Try it on'));
  await until(text(t('sessionIntro.sheetTitle')));
  // The session restores (there is none) before the sources can open.
  for (var i = 0; i < 20; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump(const Duration(milliseconds: 16));
  }
  await tap(text(t('sessionIntro.consentLegal')));
  await tap(text(t('sessionIntro.primaryCtaPhoto')));
  await until(text(t('heightSetting.title')));
  await tap(text(t('heightSetting.confirm')));
  await until(text(t('sizeAndStyleSelection.variantSubtitle')));
  await tap(find.byKey(const ValueKey('try-on-primary')));
  await until(find.textContaining(t('tryOnView.aiGeneratedLabel')));
  final addToBag = find.byWidgetPredicate(
    (w) => w is Text && (w.data ?? '').startsWith('Add ') && (w.data ?? '').contains('bag'),
  );
  await until(addToBag);
  // The bag button enables once the result image is shown.
  for (var i = 0; i < 50 && find.text('In the bag: 1').evaluate().isEmpty; i++) {
    await tap(addToBag);
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.pump(const Duration(seconds: 1));
}
