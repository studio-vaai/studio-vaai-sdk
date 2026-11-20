import 'dart:async';

import 'package:camera/camera.dart' as cam;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';

import '../generated/state_machine.dart' show DeviceException;

/// A photo the shopper picked or took: its original bytes, as the device has them.
@immutable
final class DevicePhoto {
  const DevicePhoto(this.bytes, {required this.mimeType, this.name});

  /// The original file, with its camera metadata.
  final Uint8List bytes;

  /// Its media type, such as `image/jpeg` or `image/heic`.
  final String mimeType;

  /// Its file name, when the device gives one.
  final String? name;
}

/// The device could not do what the flow asked; [error] says why, in the
/// core's terms.
final class DeviceFailure implements Exception {
  const DeviceFailure(this.error, [this.cause]);
  final DeviceException error;
  final Object? cause;
  @override
  String toString() => 'DeviceFailure(${error.name}${cause == null ? '' : ': $cause'})';
}

/// A live camera the flow holds while the camera screen shows it.
abstract interface class TryOnCamera {
  /// The camera in use, and every camera the device has, by ID.
  String? get selected;
  List<String> get available;

  /// Whether the preview is mirrored, as a front camera's is.
  bool get mirrored;

  /// The live preview.
  Widget preview(BuildContext context);

  /// Takes a still photo.
  Future<DevicePhoto> capture();

  /// Completes when the OS takes the camera away (an incoming call, the app
  /// going away); the flow then shows the camera as lost.
  Future<DeviceException> get lost;

  /// Releases the camera.
  Future<void> close();
}

/// The devices the try-on flow uses: the photo library and the camera.
///
/// [PlatformTryOnDevices] uses `image_picker` and `camera`. Implement your
/// own to use other plugins, or a scripted one in tests.
abstract interface class TryOnDevices {
  /// Lets the shopper pick a photo from their library; `null` when they
  /// close the picker without one. Throws [DeviceFailure].
  Future<DevicePhoto?> pickPhoto();

  /// Opens a camera: [deviceId] when given, otherwise the front camera.
  /// Throws [DeviceFailure].
  Future<TryOnCamera> openCamera({String? deviceId});
}

/// The photo library through `image_picker`, the camera through `camera`.
final class PlatformTryOnDevices implements TryOnDevices {
  PlatformTryOnDevices({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<DevicePhoto?> pickPhoto() async {
    try {
      // The original file: the core reads its camera metadata before the
      // photo is downscaled for upload.
      final file = await _picker.pickImage(source: ImageSource.gallery, requestFullMetadata: true);
      if (file == null) return null;
      final bytes = await file.readAsBytes();
      return DevicePhoto(
        bytes,
        mimeType: file.mimeType ?? mimeTypeOf(file.name, bytes),
        name: file.name,
      );
    } on PlatformException catch (error) {
      throw DeviceFailure(_pickerError(error.code), error);
    } catch (error) {
      throw DeviceFailure(DeviceException.failed, error);
    }
  }

  @override
  Future<TryOnCamera> openCamera({String? deviceId}) async {
    final List<cam.CameraDescription> cameras;
    try {
      cameras = await cam.availableCameras();
    } on cam.CameraException catch (error) {
      throw DeviceFailure(_cameraError(error.code), error);
    } catch (error) {
      // No camera plugin on this platform (desktop), or none at all.
      throw DeviceFailure(DeviceException.unavailable, error);
    }
    if (cameras.isEmpty) throw const DeviceFailure(DeviceException.unavailable);
    final chosen =
        cameras.where((c) => c.name == deviceId).firstOrNull ??
        cameras.where((c) => c.lensDirection == cam.CameraLensDirection.front).firstOrNull ??
        cameras.first;
    final controller = cam.CameraController(
      chosen,
      cam.ResolutionPreset.veryHigh,
      enableAudio: false,
      imageFormatGroup: cam.ImageFormatGroup.jpeg,
    );
    try {
      await controller.initialize();
    } on cam.CameraException catch (error) {
      await controller.dispose();
      throw DeviceFailure(_cameraError(error.code), error);
    }
    return _PluginCamera(controller, [for (final c in cameras) c.name]);
  }

  static DeviceException _pickerError(String code) => switch (code) {
    'photo_access_denied' || 'camera_access_denied' => DeviceException.permissionDenied,
    'no_available_camera' => DeviceException.unavailable,
    _ => DeviceException.failed,
  };

  static DeviceException _cameraError(String code) => switch (code) {
    'CameraAccessDenied' ||
    'CameraAccessDeniedWithoutPrompt' ||
    'CameraAccessRestricted' ||
    'cameraPermission' => DeviceException.permissionDenied,
    'cameraNotFound' || 'CameraNotFound' => DeviceException.unavailable,
    'AudioAccessDenied' => DeviceException.permissionDenied,
    _ => DeviceException.failed,
  };
}

final class _PluginCamera implements TryOnCamera {
  _PluginCamera(this._controller, this.available) {
    _controller.addListener(_watch);
  }

  final cam.CameraController _controller;
  final _lost = Completer<DeviceException>();
  bool _closed = false;

  @override
  final List<String> available;

  @override
  String? get selected => _controller.description.name;

  @override
  bool get mirrored => _controller.description.lensDirection == cam.CameraLensDirection.front;

  void _watch() {
    final value = _controller.value;
    if (!_closed && value.hasError && !_lost.isCompleted) {
      _lost.complete(DeviceException.interrupted);
    }
  }

  @override
  Future<DeviceException> get lost => _lost.future;

  @override
  Widget preview(BuildContext context) => cam.CameraPreview(_controller);

  @override
  Future<DevicePhoto> capture() async {
    try {
      final file = await _controller.takePicture();
      final bytes = await file.readAsBytes();
      return DevicePhoto(bytes, mimeType: 'image/jpeg', name: file.name);
    } on cam.CameraException catch (error) {
      throw DeviceFailure(PlatformTryOnDevices._cameraError(error.code), error);
    }
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _controller.removeListener(_watch);
    await _controller.dispose();
  }
}

/// The media type of an image, from its file name or its first bytes.
String mimeTypeOf(String? name, Uint8List bytes) {
  bool starts(List<int> magic, [int offset = 0]) {
    if (bytes.length < offset + magic.length) return false;
    for (var i = 0; i < magic.length; i++) {
      if (bytes[offset + i] != magic[i]) return false;
    }
    return true;
  }

  if (starts([0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4E, 0x47])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) {
    final brand = String.fromCharCodes(bytes.sublist(8, 12));
    if (brand.startsWith('hei') || brand.startsWith('hev') || brand == 'mif1' || brand == 'msf1') {
      return 'image/heic';
    }
    if (brand == 'avif') return 'image/avif';
  }
  final lower = name?.toLowerCase() ?? '';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'application/octet-stream';
}
