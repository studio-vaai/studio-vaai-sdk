// Golden images of every screen state in English/light and German/dark, and
// of the main screens in the other two combinations, on a 390×844 phone. Update with `flutter test --update-goldens
// test/goldens_test.dart`; the files are under test/goldens/.
//
// With --dart-define=TRY_ON_SHOTS=<dir> the same states are written to <dir>
// at twice the resolution instead of compared, for side-by-side comparison
// with the web components' screens.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/widgets.dart';

import 'support/harness.dart';
import 'support/scenarios.dart';

const _shots = String.fromEnvironment('TRY_ON_SHOTS');

void main() {
  setUpAll(loadFonts);

  // Comparison shots take every combination; the checked-in goldens keep
  // the package small (they are exported as plain files).
  const main = {
    'intro',
    'height',
    'selection',
    'result',
    'result-fit',
    'result-fit-pinned',
    'result-fit-loading',
    'result-fit-unavailable',
  };
  List<(String, TryOnAppearance)> variants(String name) => [
    ('en', TryOnAppearance.light),
    if (_shots.isNotEmpty || main.contains(name)) ('en', TryOnAppearance.dark),
    if (_shots.isNotEmpty || main.contains(name)) ('de', TryOnAppearance.light),
    ('de', TryOnAppearance.dark),
  ];

  // The wide layout (a 1200×880 window: the web's 65rem × 50rem dialog).
  const wide = {
    'intro',
    'camera-live',
    'height',
    'selection',
    'selection-gated',
    'result-fit',
    'result-picker',
  };
  final layouts = [
    for (final MapEntry(key: name, value: scenario) in scenarios.entries)
      for (final (locale, appearance) in variants(name))
        (name, scenario, locale, appearance, false),
    for (final MapEntry(key: name, value: scenario) in scenarios.entries)
      if (wide.contains(name))
        for (final (locale, appearance) in [
          ('en', TryOnAppearance.light),
          ('de', TryOnAppearance.dark),
          if (_shots.isNotEmpty) ('en', TryOnAppearance.dark),
          if (_shots.isNotEmpty) ('de', TryOnAppearance.light),
        ])
          (name, scenario, locale, appearance, true),
  ];
  for (final (name, scenario, locale, appearance, isWide) in layouts) {
    {
      final id = '$name${isWide ? '--wide' : ''}--$locale-${appearance.name}';
      testWidgets(id, (tester) async {
        final h = Harness();
        addTearDown(h.dispose);
        await start(
          tester,
          h,
          locale: locale,
          appearance: appearance,
          size: isWide ? const Size(1200, 880) : const Size(390, 844),
          pixelRatio: _shots.isEmpty ? 1 : 2,
        );
        await scenario(tester, h);
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump();
        expect(h.errors, isEmpty);
        if (_shots.isNotEmpty) {
          await _write(tester, '$_shots/$id.png');
        } else {
          await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/$id.png'));
        }
        // Close the flow so its route and timers end with the test.
        h.controller.close();
        await tester.pump(const Duration(seconds: 1));
      });
    }
  }
  _zoom();
}

// The pinch on the result: the copy lifted over the page at about 2.2×.
void _zoom() {
  testWidgets('result-zoom--en-light', (tester) async {
    final h = Harness();
    addTearDown(h.dispose);
    await start(tester, h, pixelRatio: _shots.isEmpty ? 1 : 2);
    await scenarios['result']!(tester, h);
    final (one, two) = await pinchResult(tester);
    if (_shots.isNotEmpty) {
      await _write(tester, '$_shots/result-zoom--en-light.png');
    } else {
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/result-zoom--en-light.png'),
      );
    }
    await one.up();
    await two.up();
    await tester.pump(const Duration(milliseconds: 500));
    h.controller.close();
    await tester.pump(const Duration(seconds: 1));
  });
}

Future<void> _write(WidgetTester tester, String path) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(Harness.shotKey));
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: tester.view.devicePixelRatio);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    File(path).writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}
