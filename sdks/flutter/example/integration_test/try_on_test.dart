// The whole ready-made try-on in the example app, on the real core, against
// the scripted API with scripted devices: product page → consent → library
// photo → height → try-on → result → add to bag. Runs on a device
// (`flutter test integration_test/try_on_test.dart -d <device>`) and, as
// test/try_on_test.dart, in the host's test engine.
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import '../test/try_on_flow.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('the ready-made try-on from product page to bag', (tester) async {
    await runTryOnFlow(tester);
    expect(find.text('In the bag: 1'), findsOneWidget);
  });
}
