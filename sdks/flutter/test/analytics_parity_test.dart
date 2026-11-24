// Analytics parity with the web SDK: the inputs in analytics_parity/input.json
// through this package's createTryOnAnalytics must send exactly the requests
// analytics_parity/expected.json records, which the web's createTryOnAnalytics
// generates (sdks/core-rs/test/analytics-parity.test.ts, also a check there).
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/analytics.dart';
import 'package:studio_vaai/studio_vaai.dart';

final class _Collector implements HttpTransport {
  final sent = <Map<String, Object?>>[];
  final eventIds = <String>{};

  @override
  Future<HttpResponse> send(HttpRequest request) async {
    String? header(String name) =>
        request.headers.where((h) => h.name.toLowerCase() == name.toLowerCase()).firstOrNull?.value;
    final body = jsonDecode(utf8.decode(request.body!)) as Map<String, Object?>;
    eventIds.add(body.remove('eventId') as String);
    sent.add({
      'method': request.method,
      'path': Uri.parse(request.url).path,
      'clientApiKey': header('X-Client-Api-Key'),
      'body': body,
    });
    return HttpResponse(status: 204, headers: [], body: Uint8List(0));
  }
}

void main() {
  test('the Flutter mapper sends what the web mapper sends', () async {
    final input = jsonDecode(File('test/analytics_parity/input.json').readAsStringSync()) as Map;
    final expected =
        jsonDecode(File('test/analytics_parity/expected.json').readAsStringSync()) as Map;
    final collector = _Collector();
    var enabled = true;
    final analytics = createTryOnAnalytics(
      clientApiKey: input['clientApiKey'] as String,
      baseUrl: input['baseUrl'] as String,
      enabled: () => enabled,
      transport: collector,
    );
    void Function(TryOnExperienceEvent)? emit;
    analytics.observe((listener) {
      emit = listener;
      return () => emit = null;
    });
    for (final operation in (input['operations'] as List).cast<Map<String, Object?>>()) {
      switch (operation['op']) {
        case 'event':
          emit!(TryOnExperienceEvent.fromJson((operation['event']! as Map).cast()));
        case 'entrypointImpression':
          analytics.entrypointImpression(
            operation['productId']! as String,
            operation['entry']! as String,
          );
        case 'cartItemAdded' || 'orderPlaced':
          final event = CommerceAnalyticsEvent(
            productId: operation['productId']! as String,
            foreignIds: (operation['foreignIds']! as Map).cast(),
            recommendedForeignIds: (operation['recommendedForeignIds'] as Map?)?.cast(),
          );
          operation['op'] == 'cartItemAdded'
              ? analytics.cartItemAdded(event)
              : analytics.orderPlaced(event);
        case 'experimentAssigned':
          analytics.experimentAssigned(operation['enabled']! as bool);
        case 'enabled':
          enabled = operation['value']! as bool;
      }
      // Each delivery finishes before the next input, as in the web check.
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    analytics.dispose();
    expect(collector.sent, expected['sent']);
    expect(collector.eventIds, hasLength(collector.sent.length));
    final uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
    expect(collector.eventIds.every(uuid.hasMatch), isTrue);
  });

  test('events in the same turn as dispose are sent; later ones are not', () async {
    final collector = _Collector();
    final analytics = createTryOnAnalytics(
      clientApiKey: 'key',
      enabled: () => true,
      transport: collector,
    );
    late void Function(TryOnExperienceEvent) emit;
    analytics.observe((listener) {
      emit = listener;
      return () {};
    });
    const closed = TryOnExperienceEvent('sv-try-on-closed', {'productId': 'p', 'step': 'try-on'});
    // As a host disposing its analytics just before the experience's final events.
    analytics.dispose();
    emit(closed);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    emit(closed);
    analytics.experimentAssigned(true);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(collector.sent.map((s) => ((s['body']! as Map)['event']! as Map)['name']), [
      'view-closed',
    ]);
  });

  test('the SDK version names this package and its pubspec version', () {
    final version = RegExp(
      r'^version: (\S+)$',
      multiLine: true,
    ).firstMatch(File('pubspec.yaml').readAsStringSync())!.group(1);
    expect(studioVaaiSdkVersion, 'studio_vaai@$version');
  });
}
