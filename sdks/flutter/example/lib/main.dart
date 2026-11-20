// Drives one studio vaai try-on session: start a session, show a product,
// upload a photo, set the height, and show the try-on.
//
// Without a client API key it runs against `ScriptedApi`, in process. With
// one, it calls the real API; pass the settings as --dart-define values:
//
//   flutter run -d macos \
//     --dart-define=STUDIO_VAAI_CLIENT_API_KEY=sv_client_... \
//     --dart-define=STUDIO_VAAI_BASE_URL=https://api.studio-vaai.com \
//     --dart-define=STUDIO_VAAI_PRODUCT_ID=... \
//     --dart-define=STUDIO_VAAI_PHOTO=/path/to/full-body-photo.jpg \
//     --dart-define=STUDIO_VAAI_HEIGHT_CM=175
//
// Without STUDIO_VAAI_PHOTO it uploads a blank image, which the API rejects
// (no person in it): enough to check the session and upload on a device.
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';

const _clientApiKey = String.fromEnvironment('STUDIO_VAAI_CLIENT_API_KEY');
const _baseUrl = String.fromEnvironment(
  'STUDIO_VAAI_BASE_URL',
  defaultValue: StudioVaai.defaultBaseUrl,
);
const _productId = String.fromEnvironment('STUDIO_VAAI_PRODUCT_ID');
const _photo = String.fromEnvironment('STUDIO_VAAI_PHOTO');
const _heightCm = String.fromEnvironment('STUDIO_VAAI_HEIGHT_CM', defaultValue: '175');

void main() => runApp(const ExampleApp());

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'studio vaai',
    theme: ThemeData(colorSchemeSeed: Colors.black),
    home: const SessionScreen(),
  );
}

class SessionScreen extends StatefulWidget {
  const SessionScreen({super.key});

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  final _log = <String>[];
  TryOn? _tryOn;
  bool _running = false;

  bool get _scripted => _clientApiKey.isEmpty;

  void _say(String line) => setState(() => _log.add(line));

  Future<void> _run() async {
    setState(() {
      _log.clear();
      _tryOn = null;
      _running = true;
    });
    final sdk = StudioVaai(
      clientApiKey: _scripted ? 'sv_client_scripted' : _clientApiKey,
      baseUrl: _scripted ? ScriptedApi.baseUrl : _baseUrl,
      transport: _scripted ? ScriptedApi() : null,
      clientName: 'studio-vaai-flutter-example',
    );
    TryOnJourney? journey;
    try {
      _say(_scripted ? 'Scripted API (no client API key set)' : 'API: $_baseUrl');
      _say('API version ${sdk.apiVersion}');
      final product = await sdk.product(_scripted ? ScriptedApi.productId : _productId);
      _say('Product ${product.productId}: ${product.variants.length} variants');

      // Only after the shopper agreed to the processing of their photo.
      journey = await sdk.startTryOn(consent: DataProcessingConsent.granted);
      _say('Session ${journey.snapshot.session.name}');
      journey.showProduct(product);

      final Uint8List photo = _scripted
          ? scriptedPhoto
          : _photo.isEmpty
          ? _blankPhoto()
          : await File(_photo).readAsBytes();
      final mimeType = _scripted || _photo.isEmpty || _photo.toLowerCase().endsWith('.png')
          ? 'image/png'
          : 'image/jpeg';
      final body = await journey.uploadPhoto(photo, mimeType: mimeType);
      _say('Body ${body.bodyId}, estimated ${body.estimatedHeightCm.toStringAsFixed(1)} cm');

      final height = double.parse(_heightCm);
      await journey.setHeight(height);
      _say('Height set to $height cm');

      final variant = product.variants.first;
      _say('Trying on ${variant.foreignVariantIds}…');
      final watch = Stopwatch()..start();
      final tryOn = await journey.tryOn(variant.id);
      _say('Try-on ${tryOn.id} in ${watch.elapsedMilliseconds} ms');
      setState(() => _tryOn = tryOn);
    } catch (error) {
      _say('Failed: $error');
    } finally {
      journey?.dispose();
      sdk.dispose();
      setState(() => _running = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tryOn = _tryOn;
    return Scaffold(
      appBar: AppBar(title: const Text('studio vaai try-on')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  FilledButton(
                    key: const Key('run'),
                    onPressed: _running ? null : _run,
                    child: Text(_running ? 'Running…' : 'Run one session'),
                  ),
                  const SizedBox(height: 16),
                  for (final line in _log) Text(line, key: Key('log-${_log.indexOf(line)}')),
                ],
              ),
            ),
            if (tryOn != null)
              Expanded(
                child: _scripted
                    ? Text('Image: ${tryOn.imageUrl}')
                    : Image.network(tryOn.imageUrl, fit: BoxFit.contain),
              ),
          ],
        ),
      ),
    );
  }
}

/// A 600x800 grey PNG.
Uint8List _blankPhoto() {
  const width = 600, height = 800;
  final row = [0, ...List.filled(width * 3, 200)];
  final pixels = ZLibCodec().encode([for (var y = 0; y < height; y++) ...row]);
  List<int> chunk(String type, List<int> data) {
    final body = [...type.codeUnits, ...data];
    return [..._u32(data.length), ...body, ..._u32(_crc32(body))];
  }

  return Uint8List.fromList([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, //
    ...chunk('IHDR', [..._u32(width), ..._u32(height), 8, 2, 0, 0, 0]),
    ...chunk('IDAT', pixels),
    ...chunk('IEND', const []),
  ]);
}

List<int> _u32(int v) => [v >> 24 & 0xff, v >> 16 & 0xff, v >> 8 & 0xff, v & 0xff];

int _crc32(List<int> bytes) {
  var crc = 0xffffffff;
  for (final byte in bytes) {
    crc ^= byte;
    for (var k = 0; k < 8; k++) {
      crc = crc & 1 != 0 ? 0xedb88320 ^ (crc >> 1) : crc >> 1;
    }
  }
  return crc ^ 0xffffffff;
}
