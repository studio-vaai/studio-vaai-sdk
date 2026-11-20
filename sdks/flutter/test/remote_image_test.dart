// The default image provider, and the core's JPEG XL decoder behind it: the
// API keeps a body's source photo as JPEG XL, which Android cannot decode.
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:studio_vaai/src/ui/remote_image.dart';

/// A lossless 4 × 3 gradient (`cjxl -d 0`): red = 60·x, green = 100·y, blue = 200.
final _gradient = Uint8List.fromList(const [
  0xff, 0x0a, 0x10, 0x30, 0x10, 0x09, 0x08, 0x04, 0x01, 0x00, 0xc0, 0x00, 0x4b, 0x18, 0x93, //
  0x8e, 0x83, 0x83, 0x84, 0x13, 0x54, 0x27, 0x8a, 0x30, 0xee, 0xf7, 0x02, 0xc1, 0x00, 0x08,
  0x0f, 0x0f, 0xbf, 0xb3, 0xf0, 0xf0, 0xf0, 0x3b, 0x0b, 0x0f, 0x0f, 0xd7, 0xdd, 0xdd, 0xfd,
  0x23, 0x7d, 0xa7, 0xfb, 0x20, 0x71, 0x90, 0x00, 0x30, 0x33, 0x0f, 0x33, 0xf3, 0x30, 0x33,
]);

Future<List<int>> _pixel(ui.Image image, int x, int y) async {
  final data = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
  final at = (y * image.width + x) * 4;
  return [for (var i = 0; i < 4; i++) data.getUint8(at + i)];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the core decodes JPEG XL where the platform cannot', () async {
    expect(isJpegXl(_gradient), isTrue);
    final image = await decodeTryOnImage(_gradient, platform: false);
    expect((image.width, image.height), (4, 3));
    expect(await _pixel(image, 0, 0), [0, 0, 200, 255]);
    expect(await _pixel(image, 3, 2), [180, 200, 200, 255]);
  });

  test('bytes that are neither an image nor JPEG XL fail', () async {
    final junk = Uint8List.fromList(List.filled(32, 7));
    expect(isJpegXl(junk), isFalse);
    await expectLater(decodeTryOnImage(junk), throwsA(anything));
    await expectLater(decodeTryOnImage(junk, platform: false), throwsFormatException);
  });

  testWidgets('TryOnNetworkImage loads a JPEG XL photo over HTTP', (tester) async {
    // flutter_test answers every HttpClient request with 400; use real HTTP.
    final mocked = HttpOverrides.current;
    HttpOverrides.global = null;
    addTearDown(() => HttpOverrides.global = mocked);
    await tester.runAsync(() async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) {
        request.response
          ..headers.contentType = ContentType('image', 'jxl')
          ..add(_gradient)
          ..close();
      });
      final provider = TryOnNetworkImage('http://127.0.0.1:${server.port}/body.jxl');
      final stream = provider.resolve(ImageConfiguration.empty);
      final info = await _first(stream);
      expect((info.image.width, info.image.height), (4, 3));
      expect(await _pixel(info.image, 3, 2), [180, 200, 200, 255]);
    });
  });
}

Future<ImageInfo> _first(ImageStream stream) {
  final done = Completer<ImageInfo>();
  late final ImageStreamListener listener;
  listener = ImageStreamListener(
    (info, _) {
      stream.removeListener(listener);
      done.complete(info);
    },
    onError: (error, _) {
      stream.removeListener(listener);
      done.completeError(error);
    },
  );
  stream.addListener(listener);
  return done.future;
}
