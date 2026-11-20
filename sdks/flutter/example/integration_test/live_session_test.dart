// Runs the example's headless session against the real API on a device, when it is
// given a client API key (see the README's --dart-define values); skipped
// otherwise. A photo without a person ends with the photo rejected.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:studio_vaai_example/headless.dart';

const _clientApiKey = String.fromEnvironment('STUDIO_VAAI_CLIENT_API_KEY');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('one session against the API', skip: _clientApiKey.isEmpty, (tester) async {
    await tester.pumpWidget(const HeadlessApp());
    await tester.tap(find.byKey(const Key('run')));
    List<String?> log() => [for (final e in find.byType(Text).evaluate()) (e.widget as Text).data];
    bool done() =>
        log().any((l) => l != null && (l.startsWith('Try-on ') || l.startsWith('Failed')));
    for (var i = 0; i < 600 && !done(); i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
      await tester.pump(const Duration(milliseconds: 10));
    }
    debugPrint(log().join('\n'));
    expect(log(), contains('Session ready'));
    expect(
      log().any((l) => l != null && (l.startsWith('Try-on ') || l.contains('Photo rejected'))),
      isTrue,
      reason: log().join('\n'),
    );
  });
}
