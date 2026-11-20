// studio vaai analytics in the ready-made widgets: the experience's events,
// through the real core and flow, reach the collector as the web sends them.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/analytics.dart';
import 'package:studio_vaai/studio_vaai.dart';

import 'support/harness.dart';
import 'support/scenarios.dart';

final class _Collector implements HttpTransport {
  final bodies = <Map<String, Object?>>[];
  List<String> get names => [for (final b in bodies) ((b['payload']! as Map)['name']! as String)];

  @override
  Future<HttpResponse> send(HttpRequest request) async {
    bodies.add(jsonDecode(utf8.decode(request.body!)) as Map<String, Object?>);
    return HttpResponse(status: 204, headers: [], body: Uint8List(0));
  }
}

void main() {
  setUpAll(loadFonts);
  late Harness h;
  late _Collector collector;
  var enabled = true;
  setUp(() {
    h = Harness();
    collector = _Collector();
    enabled = true;
    h.analytics = createTryOnAnalytics(
      clientApiKey: 'public-key',
      enabled: () => enabled,
      visitorId: () => 'visitor',
      transport: collector,
      context: () => const {'language': 'en-US', 'screen': '390x844'},
    );
  });
  tearDown(() => h.dispose());

  Future<void> finish(WidgetTester tester) async {
    h.controller.close();
    await tester.pump(const Duration(seconds: 1));
    expect(h.errors, isEmpty);
  }

  Future<void> deliver(WidgetTester tester) =>
      tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));

  testWidgets('the journey reaches the collector, as the web reports it', (tester) async {
    await start(tester, h);
    await scenarios['result']!(tester, h);
    await deliver(tester);
    expect(
      collector.names,
      containsAllInOrder([
        'intro-opened',
        // One commit: the source starts as the consent is granted.
        'image-upload-initiated',
        'consent-granted',
        'image-uploaded',
        'height-entered',
        'variant-selection-initiated',
        'try-on-initiated',
      ]),
    );
    final first = collector.bodies.first['payload']! as Map;
    expect(first['id'], 'visitor');
    expect(first['language'], 'en-US');
    expect(first['screen'], '390x844');
    expect((first['data']! as Map)['sdk-version'], studioVaaiSdkVersion);
    expect((first['data']! as Map)['product-id'], isNotEmpty);
    await finish(tester);
  });

  testWidgets('the final events of a page that goes away are still sent', (tester) async {
    await start(tester, h);
    await scenarios['height']!(tester, h);
    await deliver(tester);
    // The app leaves the page: the try-on ends with it.
    await tester.pumpWidget(const SizedBox());
    h.analytics!.dispose();
    await deliver(tester);
    expect(collector.names.last, 'view-closed');
    final closed = collector.bodies.last['payload']! as Map;
    expect((closed['data']! as Map)['current-step'], 'height');
    // Nothing after that.
    final count = collector.bodies.length;
    h.analytics!.experimentAssigned(true);
    await deliver(tester);
    expect(collector.bodies, hasLength(count));
  });

  testWidgets('a slow try-on is reported as the web reports it', (tester) async {
    await start(tester, h);
    await scenarios['generating']!(tester, h);
    final events = <TryOnExperienceEvent>[];
    final subscription = experienceOf(h).tryOnEvents.listen(events.add);
    addTearDown(subscription.cancel);
    // The web reports a try-on still running after 30 s.
    await tester.pump(const Duration(seconds: 31));
    await deliver(tester);
    expect(events.map((e) => e.type), contains('sv-try-on-operation-slow'));
    final slow = collector.bodies.last['payload']! as Map;
    expect(slow['name'], 'experience-operation-failed');
    expect(slow['data'], containsPair('reason', 'slow'));
    expect(slow['data'], containsPair('outcome', 'in_progress'));
    expect(slow['data'], containsPair('work', 'try-on'));
    await finish(tester);
  });

  testWidgets('nothing is sent while the shop has no consent for analytics', (tester) async {
    enabled = false;
    await start(tester, h);
    await scenarios['height']!(tester, h);
    await deliver(tester);
    expect(collector.bodies, isEmpty);
    await finish(tester);
  });
}
