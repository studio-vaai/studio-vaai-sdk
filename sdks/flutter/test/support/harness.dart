import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';

import 'describe.dart';
import 'fakes.dart';
import 'gated.dart';

/// The photo guide's light artwork stands in for the shopper's photo, and
/// its dark artwork for every try-on result: real images, no real person.
final Uint8List shopperPhoto = File('assets/guide-people-light.webp').readAsBytesSync();
final Uint8List resultPhoto = File('assets/guide-people-dark.webp').readAsBytesSync();

/// Loads the package's bundled Inter (what apps get from its pubspec `fonts:`;
/// the test engine loads no asset fonts by itself) and the Material icons, so
/// goldens show the widgets' real text.
Future<void> loadFonts() async {
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final file in files) {
      loader.addFont(Future.value(ByteData.sublistView(File(file).readAsBytesSync())));
    }
    await loader.load();
  }

  await load(TryOnTokens.fontFamily, [
    for (final weight in ['Light', 'Regular', 'Medium', 'SemiBold'])
      'assets/fonts/Inter-$weight.ttf',
  ]);
  // flutter_tester runs from $FLUTTER_ROOT/bin/cache/artifacts/engine/<host>/.
  var root = Platform.environment['FLUTTER_ROOT'];
  if (root == null) {
    final executable = Platform.resolvedExecutable;
    final at = executable.indexOf('/bin/cache/');
    if (at < 0) return;
    root = executable.substring(0, at);
  }
  await load('MaterialIcons', [
    '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
  ]);
}

/// One host app with a try-on button, against [api] and [devices].
final class Harness {
  Harness({ScriptedApi? api, ScriptedDevices? devices})
    : api = api ?? ScriptedApi(),
      devices = devices ?? ScriptedDevices(photo: shopperPhoto, mimeType: 'image/webp') {
    gate = GatedApi(this.api);
    sdk = StudioVaai(clientApiKey: 'sv_client_test', baseUrl: ScriptedApi.baseUrl, transport: gate);
  }

  final ScriptedApi api;

  /// The kept session, in memory: shared by every app this harness pumps.
  final sessionStore = MemoryTryOnSessionStore();

  /// Analytics the app passes to the try-on, if a test sets it before [start].
  TryOnAnalytics? analytics;

  /// The transport: [api], with routes a test can hold.
  late final GatedApi gate;
  final ScriptedDevices devices;
  late final StudioVaai sdk;
  final controller = StudioVaaiTryOnController();
  final carts = <CartRequest>[];
  final events = <ExperienceEvent>[];
  final errors = <Object>[];
  TryOnMessages? _messages;

  /// The catalog's text for [key], in the locale the app was started with.
  String m(String key, [Map<String, Object> values = const {}]) =>
      plain((_messages ??= TryOnMessages('en')).text(key, values));

  Widget app({
    String locale = 'en',
    TryOnAppearance appearance = TryOnAppearance.light,
    Map<String, String>? messages,
    double textScale = 1,
    Map<String, VariantCommerce>? commerce,
    String? foreignId,
  }) => RepaintBoundary(
    key: shotKey,
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: StudioVaaiTryOn(
          sdk: sdk,
          productId: foreignId == null ? ScriptedApi.productId : null,
          foreignId: foreignId,
          productName: 'Oxford shirt',
          presentProduct: (details) => ProductPresentation(
            axes: scriptedPresentation(details).axes,
            variantId: details.variants.first.id,
            commerce: {
              ScriptedApi.variantM: const VariantCommerce(price: '€89'),
              ScriptedApi.variantL: const VariantCommerce(price: '€89'),
            },
          ),
          commerce: commerce,
          controller: controller,
          locale: locale,
          messages: messages,
          appearance: appearance,
          devices: devices,
          sessionStore: sessionStore,
          imageProvider: (_) => MemoryImage(resultPhoto),
          onAddToCart: (request) async => carts.add(request),
          onDownload: (bytes, type) async {},
          onEvent: events.add,
          analytics: analytics,
          onError: errors.add,
          child: const Center(child: Text('Product page')),
        ),
      ),
    ),
  );

  /// The app's repaint boundary, for screenshots.
  static const shotKey = ValueKey('try-on-shot');

  void dispose() {
    _messages?.dispose();
    sdk.dispose();
  }
}

/// Lets real asynchronous work (the native core, image decoding) run, and
/// pumps frames, until [done] holds.
Future<void> settle(
  WidgetTester tester,
  bool Function() done, {
  String? reason,
  int tries = 300,
}) async {
  for (var i = 0; i < tries && !done(); i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
    await tester.pump(const Duration(milliseconds: 16));
  }
  // Let routes, animations and fades started by the last frame finish.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pump(const Duration(milliseconds: 400));
  if (reason != null) expect(done(), isTrue, reason: reason);
}

Future<void> settleFor(WidgetTester tester, Finder finder) async {
  String state() {
    final experience = tester.any(find.byType(TryOnFlowView))
        ? tester.widget<TryOnFlowView>(find.byType(TryOnFlowView)).experience
        : null;
    return experience == null ? 'no flow view' : describe(experience.view);
  }

  await settle(tester, () => finder.evaluate().isNotEmpty);
  expect(finder.evaluate(), isNotEmpty, reason: 'waiting for $finder; ${state()}');
}

/// Precaches the test images so the first frame shows them.
Future<void> warmImages(WidgetTester tester) async {
  await tester.runAsync(() async {
    final context = tester.element(find.byType(Navigator).first);
    await precacheImage(MemoryImage(shopperPhoto), context);
    await precacheImage(MemoryImage(resultPhoto), context);
    await precacheImage(
      const AssetImage('assets/guide-people-light.webp', package: 'studio_vaai'),
      context,
    );
    await precacheImage(
      const AssetImage('assets/guide-people-dark.webp', package: 'studio_vaai'),
      context,
    );
  });
}

/// The experience behind the harness's widget.
TryOnExperience experienceOf(Harness h) => h.controller.experience!;

/// Opens the try-on once the product is ready.
Future<void> openTryOn(WidgetTester tester, Harness h) async {
  await settle(tester, () => h.controller.ready, reason: 'product ready');
  expect(h.controller.open(), isTrue);
  await settle(
    tester,
    () => experienceOf(h).view.domain.session != SessionPhase.restoring,
    reason: 'session restored',
  );
}

/// Text without MF2's bidi isolation marks (U+2068, U+2069).
String plain(String value) => value.replaceAll(RegExp('[\u2068\u2069]'), '');

String _textOf(Widget widget) => switch (widget) {
  Text(:final data?) => data,
  Text(:final textSpan?) => textSpan.toPlainText(),
  RichText(:final text) => text.toPlainText(),
  _ => '',
};

/// A text widget showing [value], ignoring bidi isolation marks.
Finder text(String value) => find.byWidgetPredicate(
  (w) => w is Text && plain(_textOf(w)) == value,
  description: 'text "$value"',
  skipOffstage: true,
);

/// The height field showing [cm].
Finder heightField(String cm) => find.byWidgetPredicate(
  (w) => w is EditableText && w.controller.text == cm,
  description: 'height $cm',
);

/// A text widget containing [value], ignoring bidi isolation marks.
Finder textContaining(String value) => find.byWidgetPredicate(
  (w) => (w is Text) && plain(_textOf(w)).contains(value),
  description: 'text containing "$value"',
);

/// Every text on screen, for failure messages.
List<String> texts() => [for (final e in find.byType(Text).evaluate()) plain(_textOf(e.widget))];

Future<void> tapText(WidgetTester tester, String value) async {
  final finder = find.descendant(of: find.byType(TryOnFlowView), matching: text(value));
  expect(finder, findsWidgets, reason: 'no "$value" among ${texts()}');
  await tester.ensureVisible(finder.first);
  await tester.tap(finder.first);
  await tester.pump();
}

/// Pumps [h]'s app on a phone-sized view and opens the try-on.
Future<void> start(
  WidgetTester tester,
  Harness h, {
  String locale = 'en',
  TryOnAppearance appearance = TryOnAppearance.light,
  double textScale = 1,
  Size size = const Size(390, 844),
  double pixelRatio = 3,
}) async {
  tester.view.physicalSize = size * pixelRatio;
  tester.view.devicePixelRatio = pixelRatio;
  addTearDown(tester.view.reset);
  h._messages?.dispose();
  h._messages = TryOnMessages(locale);
  await tester.pumpWidget(h.app(locale: locale, appearance: appearance, textScale: textScale));
  await warmImages(tester);
  await openTryOn(tester, h);
}

/// Shorthands for the flow's dispatches a shopper would tap.
void consent(Harness h) =>
    experienceOf(h).dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));

Future<void> settleView(WidgetTester tester, Harness h, bool Function(FlowView view) done) async {
  await settle(tester, () => done(experienceOf(h).view));
  expect(done(experienceOf(h).view), isTrue, reason: describe(experienceOf(h).view));
}
