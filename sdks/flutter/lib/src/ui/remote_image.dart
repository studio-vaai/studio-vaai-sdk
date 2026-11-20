import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import '../generated/studio_vaai_core.dart' as core;

/// A remote image of the try-on, such as a result or a restored session's
/// photo, the default `imageProvider`.
///
/// Like [NetworkImage], with one addition: the API keeps a body's source
/// photo as JPEG XL, which browsers and Apple platforms decode but Android
/// does not. Bytes the platform cannot decode that are JPEG XL are decoded
/// by the core instead.
@immutable
class TryOnNetworkImage extends ImageProvider<TryOnNetworkImage> {
  const TryOnNetworkImage(this.url);

  final String url;

  @override
  Future<TryOnNetworkImage> obtainKey(ImageConfiguration configuration) => SynchronousFuture(this);

  @override
  ImageStreamCompleter loadImage(TryOnNetworkImage key, ImageDecoderCallback decode) =>
      OneFrameImageStreamCompleter(
        _load(decode),
        informationCollector: () => [DiagnosticsProperty<ImageProvider>('Image provider', this)],
      );

  Future<ImageInfo> _load(ImageDecoderCallback decode) async {
    final client = HttpClient()..autoUncompress = false;
    try {
      final request = await client.getUrl(Uri.parse(url));
      final response = await request.close();
      if (response.statusCode != HttpStatus.ok) {
        await response.drain<void>();
        throw NetworkImageLoadException(statusCode: response.statusCode, uri: Uri.parse(url));
      }
      final bytes = await consolidateHttpClientResponseBytes(response);
      return ImageInfo(image: await decodeTryOnImage(bytes, decode: decode));
    } finally {
      client.close(force: true);
    }
  }

  @override
  bool operator ==(Object other) => other is TryOnNetworkImage && other.url == url;

  @override
  int get hashCode => url.hashCode;

  @override
  String toString() => 'TryOnNetworkImage("$url")';
}

/// The ISO container's signature box (`JXL `).
const _jxlContainer = [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];

/// Whether [bytes] start like JPEG XL: a bare codestream or the ISO container.
bool isJpegXl(Uint8List bytes) =>
    (bytes.length >= 2 && bytes[0] == 0xff && bytes[1] == 0x0a) ||
    (bytes.length >= 12 && listEquals(bytes.sublist(0, 12), _jxlContainer));

/// Decodes [bytes] with the platform's codecs, and JPEG XL the platform
/// cannot decode with the core. [platform] false skips the platform (tests).
Future<ui.Image> decodeTryOnImage(
  Uint8List bytes, {
  ImageDecoderCallback? decode,
  bool platform = true,
}) async {
  if (platform) {
    try {
      final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
      final codec = decode != null
          ? await decode(buffer)
          : await ui.instantiateImageCodecFromBuffer(buffer);
      return (await codec.getNextFrame()).image;
    } catch (_) {
      if (!isJpegXl(bytes)) rethrow;
    }
  }
  final decoded = core.decodeJpegXl(bytes: bytes);
  if (decoded == null) throw const FormatException('The image could not be decoded.');
  final buffer = await ui.ImmutableBuffer.fromUint8List(decoded.rgba);
  final descriptor = ui.ImageDescriptor.raw(
    buffer,
    width: decoded.width,
    height: decoded.height,
    pixelFormat: ui.PixelFormat.rgba8888,
  );
  final codec = await descriptor.instantiateCodec();
  return (await codec.getNextFrame()).image;
}
