// A product page with the ready-made try-on (StudioVaaiTryOn), and the
// headless session sample as a second screen.
//
// Without a client API key it runs against `ScriptedApi`, in process, with
// the device's real camera and photo library. With one, it calls the real
// API; pass the settings as --dart-define values:
//
//   flutter run \
//     --dart-define=STUDIO_VAAI_CLIENT_API_KEY=sv_client_... \
//     --dart-define=STUDIO_VAAI_BASE_URL=https://api.studio-vaai.com \
//     --dart-define=STUDIO_VAAI_PRODUCT_ID=...
//
// STUDIO_VAAI_LOCALE (`en`, `de`, …) and STUDIO_VAAI_APPEARANCE (`dark`)
// change the experience's language and appearance.
import 'package:flutter/material.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';

import 'headless.dart';

const _clientApiKey = String.fromEnvironment('STUDIO_VAAI_CLIENT_API_KEY');
const _baseUrl = String.fromEnvironment(
  'STUDIO_VAAI_BASE_URL',
  defaultValue: StudioVaai.defaultBaseUrl,
);
const _productId = String.fromEnvironment('STUDIO_VAAI_PRODUCT_ID');
const _locale = String.fromEnvironment('STUDIO_VAAI_LOCALE', defaultValue: 'en');
const _appearance = String.fromEnvironment('STUDIO_VAAI_APPEARANCE', defaultValue: 'light');

void main() => runApp(const ExampleApp());

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key, this.devices, this.transport});

  /// The camera and library; tests pass scripted ones.
  final TryOnDevices? devices;

  /// The API's transport; [ScriptedApi] when no client key is set.
  final HttpTransport? transport;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'studio vaai',
    theme: ThemeData(colorSchemeSeed: Colors.black),
    home: ProductPage(devices: devices, transport: transport),
    routes: {'/headless': (_) => const SessionScreen()},
  );
}

/// A shop's product page: the product, and a button that opens the try-on.
class ProductPage extends StatefulWidget {
  const ProductPage({super.key, this.devices, this.transport});
  final TryOnDevices? devices;
  final HttpTransport? transport;

  @override
  State<ProductPage> createState() => _ProductPageState();
}

class _ProductPageState extends State<ProductPage> {
  static bool get _scripted => _clientApiKey.isEmpty;

  late final StudioVaai _sdk = StudioVaai(
    clientApiKey: _scripted ? 'sv_client_scripted' : _clientApiKey,
    baseUrl: _scripted ? ScriptedApi.baseUrl : _baseUrl,
    transport: widget.transport ?? (_scripted ? ScriptedApi() : null),
    clientName: 'studio-vaai-flutter-example',
  );
  final _tryOn = StudioVaaiTryOnController();
  final _bag = <String>[];

  @override
  void dispose() {
    _tryOn.dispose();
    _sdk.dispose();
    super.dispose();
  }

  void _say(String message) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Oxford shirt'),
        actions: [
          TextButton(
            key: const Key('headless'),
            onPressed: () => Navigator.of(context).pushNamed('/headless'),
            child: const Text('Headless session'),
          ),
        ],
      ),
      body: StudioVaaiTryOn(
        sdk: _sdk,
        productId: _scripted ? ScriptedApi.productId : _productId,
        productName: 'Oxford shirt',
        // The storefront names the axes and labels the items; the API only
        // knows each variant's own IDs.
        presentProduct: (details) => simpleProductPresentation(
          details,
          roles: {'size': AxisRole.size, 'colorway': AxisRole.color},
          labels: {'size': 'Size', 'colorway': 'Color'},
        ),
        controller: _tryOn,
        locale: _locale,
        appearance: _appearance == 'dark' ? TryOnAppearance.dark : TryOnAppearance.light,
        devices: widget.devices,
        // ScriptedApi's try-on images are not on the network: show a stand-in.
        imageProvider: _scripted
            ? (_) => const AssetImage('assets/guide-people-dark.webp', package: 'studio_vaai')
            : null,
        onAddToCart: (request) async {
          setState(() => _bag.add(request.variantId));
          _say('Added ${request.foreignIds.values.join(' / ')} to the bag');
        },
        onDownload: (bytes, mimeType) async => _say('Downloaded ${bytes.length} bytes ($mimeType)'),
        onLink: (uri) => _say('Open $uri'),
        onError: (error) => _say('Try-on error: $error'),
        child: ListenableBuilder(
          listenable: _tryOn,
          builder: (context, _) => Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Expanded(child: Placeholder()),
                const SizedBox(height: 16),
                Text('€89', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('try-on'),
                  onPressed: _tryOn.ready ? () => _tryOn.open() : null,
                  child: Text(_tryOn.ready ? 'Try it on' : 'Loading…'),
                ),
                const SizedBox(height: 8),
                Text('In the bag: ${_bag.length}', key: const Key('bag')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
