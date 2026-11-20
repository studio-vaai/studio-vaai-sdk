// The example's ready-made try-on in the Flutter test engine on the host, on
// the real core: `flutter test`. The same flow runs on devices from
// integration_test/try_on_test.dart.
import 'package:flutter_test/flutter_test.dart';

import 'try_on_flow.dart';

void main() {
  testWidgets('the ready-made try-on from product page to bag', (tester) async {
    await runTryOnFlow(tester);
    expect(find.text('In the bag: 1'), findsOneWidget);
    // The flow closed after adding to the bag: the product page is back.
    expect(find.text('Try it on'), findsOneWidget);
  });
}
