// Sends analytics to the real collector, only when a shop's public client key
// is given:
//
//   flutter test test/analytics_live_test.dart \
//     --dart-define=STUDIO_VAAI_CLIENT_API_KEY=sv_client_... \
//     [--dart-define=STUDIO_VAAI_ANALYTICS_BASE_URL=https://a.studio-vaai.com]
//
// It prints only the event names and the collector's status codes.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/analytics.dart';
import 'package:studio_vaai/studio_vaai.dart';

const _key = String.fromEnvironment('STUDIO_VAAI_CLIENT_API_KEY');
const _baseUrl = String.fromEnvironment(
  'STUDIO_VAAI_ANALYTICS_BASE_URL',
  defaultValue: defaultAnalyticsBaseUrl,
);

final class _Recording implements HttpTransport {
  final _io = IoHttpTransport();
  final statuses = <int>[];

  @override
  Future<HttpResponse> send(HttpRequest request) async {
    final response = await _io.send(request);
    statuses.add(response.status);
    return response;
  }
}

void main() {
  test('the collector accepts the Flutter SDK\'s events', skip: _key.isEmpty, () async {
    // flutter_test answers every HttpClient request with 400; use real HTTP.
    final mocked = HttpOverrides.current;
    HttpOverrides.global = null;
    addTearDown(() => HttpOverrides.global = mocked);
    final transport = _Recording();
    final analytics = createTryOnAnalytics(
      clientApiKey: _key,
      baseUrl: _baseUrl,
      enabled: () => true,
      transport: transport,
    );
    void Function(TryOnExperienceEvent)? emit;
    analytics.observe((listener) {
      emit = listener;
      return () {};
    });
    const product = 'flutter-sdk-live-check';
    TryOnExperienceEvent event(
      String type,
      String step, [
      Map<String, Object?> detail = const {},
    ]) => TryOnExperienceEvent(type, {'productId': product, 'step': step, ...detail});
    analytics.entrypointImpression(product, 'flutter-live-check');
    emit!(event('sv-try-on-opened', 'intro', {'entry': 'flutter-live-check'}));
    emit!(event('sv-try-on-step-changed', 'intro'));
    emit!(event('sv-try-on-consent-granted', 'intro'));
    emit!(event('sv-try-on-closed', 'intro'));
    analytics.experimentAssigned(true);
    for (var i = 0; i < 100 && transport.statuses.length < 8; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    analytics.dispose();
    // ignore: avoid_print
    print('collector statuses: ${transport.statuses}');
    expect(transport.statuses, hasLength(8));
    expect(transport.statuses.every((s) => s >= 200 && s < 300), isTrue);
  });
}
