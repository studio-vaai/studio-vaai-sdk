// Runs the example's session in the app, on the real core, against the
// scripted API: `flutter test integration_test -d macos`.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:studio_vaai_example/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('one session ends with a try-on', (tester) async {
    await tester.pumpWidget(const ExampleApp());
    await tester.tap(find.byKey(const Key('run')));
    for (var i = 0; i < 100 && find.textContaining('Image: ').evaluate().isEmpty; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump(const Duration(milliseconds: 10));
    }
    final log = [for (final e in find.byType(Text).evaluate()) (e.widget as Text).data];
    expect(log, contains('Session ready'), reason: log.join('\n'));
    expect(find.textContaining('estimated 172.0 cm'), findsOneWidget);
    expect(find.textContaining('Image: https://images.example.test/try-on-1.webp'), findsOneWidget);
    expect(find.textContaining('Failed'), findsNothing);
  });
}
