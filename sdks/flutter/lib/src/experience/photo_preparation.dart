import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

import '../generated/studio_vaai_core.dart' as core;
import '../session.dart' show PreparedPhoto;

/// The photo is in a format this device cannot decode (such as HEIC before
/// Android 9), and the API cannot take it as it is.
final class UnsupportedPhotoException implements Exception {
  const UnsupportedPhotoException(this.mimeType);
  final String mimeType;
  @override
  String toString() => 'This device cannot read $mimeType photos.';
}

/// The photo cannot be uploaded: too large, animated, or too many pixels.
final class PhotoInputException implements Exception {
  const PhotoInputException(this.reason);
  final core.PhotoInputRejection reason;
  @override
  String toString() => switch (reason) {
    core.PhotoInputRejection.byteSize => 'Photo must contain between 1 byte and 50 MiB.',
    core.PhotoInputRejection.dimensions => 'Photo dimensions exceed the processing limit.',
    core.PhotoInputRejection.animation => 'Only still photos are supported.',
    core.PhotoInputRejection.tooManyItems => 'Photo contains too many image items.',
  };
}

/// Prepares a photo for upload as the web does (`prepare-upload`): checks the
/// core's input limits, reads the original's camera metadata, and downscales
/// and re-encodes it as JPEG when the core's encoding plan asks for that. The
/// metadata carries both the original's and the uploaded image's size, so the
/// backend scales the focal length to the bytes it receives.
///
/// HEIC/HEIF (and any format the API does not take) is decoded by the
/// platform (ImageIO on iOS and macOS, ImageDecoder on Android 9+) and always
/// re-encoded as JPEG, as the web converts HEIC before upload. Where the
/// platform cannot decode it, [UnsupportedPhotoException] stops the upload:
/// the flow shows the photo as unreadable instead of sending a file the
/// backend cannot use. JPEG, PNG and WebP the platform cannot decode go up as
/// the original for the server's decoder, as on the web.
Future<PreparedPhoto> preparePhotoForUpload(Uint8List original, String mimeType) async {
  _assertSize(original.length);
  final header = await core.inspectPhotoHeader(
    size: original.length,
    source: _BytesSource(original),
  );
  if (header case core.RejectedPhotoHeader(:final reason)) throw PhotoInputException(reason);
  final limits = core.photoInputLimits();
  final metadata = core.readImageMetadata(
    image: original.length <= limits.headerBytes
        ? original
        : Uint8List.sublistView(original, 0, limits.headerBytes),
  );
  // Unknown or incomplete headers go to the server's isolated decoder, not a
  // client decoder whose allocation would precede the dimension checks.
  if (header is! core.StillPhotoHeader) {
    if (!_uploadable(mimeType)) throw UnsupportedPhotoException(mimeType);
    return _original(original, mimeType, metadata, null);
  }
  final ui.ImageDescriptor descriptor;
  try {
    final buffer = await ui.ImmutableBuffer.fromUint8List(original);
    descriptor = await ui.ImageDescriptor.encoded(buffer);
  } catch (_) {
    // Not decodable here: HEIC without a platform decoder never goes up as is.
    if (!_uploadable(mimeType)) throw UnsupportedPhotoException(mimeType);
    return _original(original, mimeType, metadata, null);
  }
  try {
    final width = descriptor.width, height = descriptor.height;
    _assertDimensions(width, height);
    final plan = core.photoEncodingPlan(
      decoded: core.UploadedPhotoSize(width: width, height: height),
    );
    if (plan is! core.ResizeJpegPhotoEncodingPlan && _uploadable(mimeType)) {
      return _original(original, mimeType, metadata, (width: width, height: height));
    }
    final (targetWidth, targetHeight, quality) = switch (plan) {
      core.ResizeJpegPhotoEncodingPlan(:final width, :final height, :final quality) => (
        width,
        height,
        quality,
      ),
      // A format the API does not take (HEIC) is re-encoded at its own size.
      _ => (width, height, 0.9),
    };
    final codec = await descriptor.instantiateCodec(
      targetWidth: targetWidth,
      targetHeight: targetHeight,
    );
    final frame = await codec.getNextFrame();
    codec.dispose();
    final image = frame.image;
    final rgba = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    final (w, h) = (image.width, image.height);
    image.dispose();
    if (rgba == null) {
      return _original(original, mimeType, metadata, (width: width, height: height));
    }
    final jpeg = await compute(_encodeJpeg, (
      rgba.buffer.asUint8List(rgba.offsetInBytes, rgba.lengthInBytes),
      w,
      h,
      (quality * 100).round().clamp(1, 100),
    ));
    _assertSize(jpeg.length);
    return PreparedPhoto(
      jpeg,
      mimeType: 'image/jpeg',
      metadata: metadata == null
          ? null
          : core.PhotoUploadMetadata(
              original: metadata,
              uploaded: core.UploadedPhotoSize(width: w, height: h),
            ),
    );
  } finally {
    descriptor.dispose();
  }
}

bool _uploadable(String mimeType) =>
    mimeType == 'image/jpeg' || mimeType == 'image/png' || mimeType == 'image/webp';

PreparedPhoto _original(
  Uint8List bytes,
  String mimeType,
  core.ImageMetadata? metadata,
  ({int width, int height})? decoded,
) => PreparedPhoto(
  bytes,
  mimeType: mimeType,
  metadata: metadata == null
      ? null
      : core.PhotoUploadMetadata(
          original: metadata,
          uploaded: decoded == null
              ? null
              : core.UploadedPhotoSize(width: decoded.width, height: decoded.height),
        ),
);

Uint8List _encodeJpeg((Uint8List, int, int, int) input) {
  final (rgba, width, height, quality) = input;
  final image = img.Image.fromBytes(
    width: width,
    height: height,
    bytes: rgba.buffer,
    bytesOffset: rgba.offsetInBytes,
    numChannels: 4,
    order: img.ChannelOrder.rgba,
  );
  return img.encodeJpg(image, quality: quality);
}

int _u32(int value) => value >= 0 && value <= 0xFFFFFFFF ? value : 0;

void _assertSize(int size) {
  final reason = core.photoSizeRejection(size: _u32(size));
  if (reason != null) throw PhotoInputException(reason);
}

void _assertDimensions(int width, int height) {
  final reason = core.photoDimensionsRejection(width: _u32(width), height: _u32(height));
  if (reason != null) throw PhotoInputException(reason);
}

final class _BytesSource implements core.PhotoHeaderSource {
  _BytesSource(this._bytes);
  final Uint8List _bytes;

  @override
  Future<Uint8List> read(int offset, int length) async {
    final start = math.min(offset, _bytes.length);
    final end = math.min(start + length, _bytes.length);
    return Uint8List.fromList(Uint8List.sublistView(_bytes, start, end));
  }
}
