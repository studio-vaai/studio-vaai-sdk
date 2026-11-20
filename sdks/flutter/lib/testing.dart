/// A scripted studio vaai API and scripted devices, for tests and demos
/// without a network, a camera or a photo library.
///
/// Pass [ScriptedApi] as [StudioVaai]'s transport: it answers the requests
/// the core builds for one product in sizes M and L, records them, and lets
/// a test change the answer for one route (`overrides['POST /bodies'] = ...`).
/// Pass [ScriptedDevices] as a [StudioVaaiTryOn]'s devices.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';

import 'studio_vaai.dart';
import 'widgets.dart';

final class ScriptedApi implements HttpTransport {
  ScriptedApi({this.estimatedHeightCm = 172});

  static const baseUrl = 'https://api.example.test';
  static const uploadUrl = 'https://uploads.example.test/staging/1';
  static const productId = '0192f0e0-0000-7000-8000-000000000001';
  static const bodyId = '0192f0e0-0000-7000-8000-0000000000b0';
  static const variantM = '0192f0e0-0000-7000-8000-00000000000a';
  static const variantL = '0192f0e0-0000-7000-8000-00000000000b';

  final double estimatedHeightCm;
  final List<HttpRequest> requests = [];

  /// An override may answer later, to hold a request open.
  final Map<String, FutureOr<HttpResponse> Function(HttpRequest)> overrides = {};
  int _revision = 0;
  int _tryOns = 0;
  bool _hasBody = false;
  double? _height;

  /// The requests sent to one route, such as `POST /bodies`.
  List<HttpRequest> sent(String route) => [
    for (final r in requests)
      if (_route(r) == route) r,
  ];

  static String _route(HttpRequest r) =>
      r.url == uploadUrl ? '${r.method} upload' : '${r.method} ${Uri.parse(r.url).path}';

  @override
  Future<HttpResponse> send(HttpRequest request) async {
    requests.add(request);
    // Answer asynchronously, as a network would.
    await Future<void>.delayed(const Duration(milliseconds: 1));
    final route = _route(request);
    final override = overrides[route];
    if (override != null) return await override(request);
    return switch (route) {
      'POST /session/bearer' => json(201, {'token': 'bearer-1', 'expiresAt': _inOneHour()}),
      'GET /products/$productId' => json(200, {
        'productId': productId,
        'variants': [
          {
            'id': variantM,
            'foreignVariantIds': {'size': 'M'},
          },
          {
            'id': variantL,
            'foreignVariantIds': {'size': 'L'},
          },
        ],
      }),
      'POST /bodies/upload-urls' => json(200, {
        'uploadUrl': uploadUrl,
        'method': 'PUT',
        'stagingKey': 'staging-1',
        'requiredHeaders': [
          {'name': 'Content-Type', 'value': 'image/png'},
        ],
        'expiresAt': _inOneHour(),
      }),
      'PUT upload' => HttpResponse(status: 200, headers: [], body: Uint8List(0)),
      'GET /session' => json(200, {'expiresAt': _inOneHour()}),
      'GET /bodies' => json(200, {
        'bodies': [
          if (_hasBody)
            {
              'bodyId': bodyId,
              'createdAt': '2026-11-16T10:00:00Z',
              'estimatedHeightCm': estimatedHeightCm,
              'sourceImageUrl': 'https://images.example.test/body.webp',
              'sourceImageUrlExpiresAt': _inOneHour(),
              if (_height != null) 'userProvidedHeightCm': _height,
              if (_height != null) 'bodyRevisionId': 'revision-$_revision',
            },
        ],
      }),
      'POST /bodies' => (() {
        _hasBody = true;
        return json(201, {
          'body': {
            'bodyId': bodyId,
            'createdAt': '2026-11-16T10:00:00Z',
            'estimatedHeightCm': estimatedHeightCm,
            'sourceImageUrl': 'https://images.example.test/body.webp',
            'sourceImageUrlExpiresAt': _inOneHour(),
          },
        });
      })(),
      'PATCH /bodies/$bodyId/height' => (() {
        _height = ((jsonDecode(utf8.decode(request.body!)) as Map)['heightCm'] as num?)?.toDouble();
        return json(200, {'bodyRevisionId': 'revision-${++_revision}'});
      })(),
      'GET /products/$productId/recommended-size' => problem(
        400,
        'size-recommendation-unavailable',
      ),
      'POST /products/$productId/try-on' => _tryOn(request),
      _ => problem(404, 'not-found'),
    };
  }

  HttpResponse _tryOn(HttpRequest request) {
    final body = jsonDecode(utf8.decode(request.body!)) as Map<String, Object?>;
    _tryOns++;
    return json(201, {
      'tryOnId': '0192f0e0-0000-7000-8000-0000000100${_tryOns.toString().padLeft(2, '0')}',
      'variantId': body['variantId'],
      'bodyRevisionId': body['bodyRevisionId'],
      'imageUrl': 'https://images.example.test/try-on-$_tryOns.webp',
      'scene': {'overlayColor': '#ffffff'},
    });
  }

  static HttpResponse json(int status, Object body) => HttpResponse(
    status: status,
    headers: [HttpHeader(name: 'content-type', value: 'application/json')],
    body: Uint8List.fromList(utf8.encode(jsonEncode(body))),
  );

  static HttpResponse problem(int status, String kind) => HttpResponse(
    status: status,
    headers: [HttpHeader(name: 'content-type', value: 'application/problem+json')],
    body: Uint8List.fromList(
      utf8.encode(jsonEncode({'type': 'about:blank', 'title': kind, 'status': status})),
    ),
  );

  static String _inOneHour() =>
      DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String();
}

/// A 1x2 PNG: enough for the core to read its size from the header.
final Uint8List scriptedPhoto = Uint8List.fromList([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, //
  0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, //
  0, 0, 0, 1, 0, 0, 0, 2, 8, 2, 0, 0, 0, 0, 0, 0, 0,
]);

/// Devices for tests: the library returns [photo] (or fails, or is
/// cancelled), the camera is a grey box that captures [photo].
final class ScriptedDevices implements TryOnDevices {
  ScriptedDevices({
    Uint8List? photo,
    this.mimeType = 'image/png',
    this.cameras = const ['front', 'back'],
  }) : photo = photo ?? scriptedPhoto;

  Uint8List photo;
  String mimeType;
  final List<String> cameras;
  DeviceException? pickerFailure;
  DeviceException? cameraFailure;
  bool cancelPicker = false;
  int picks = 0, opened = 0, closed = 0, captures = 0;
  Completer<DevicePhoto?>? pickerGate;

  @override
  Future<DevicePhoto?> pickPhoto() async {
    picks++;
    final gate = pickerGate;
    if (gate != null) return gate.future;
    await Future<void>.delayed(Duration.zero);
    if (pickerFailure case final failure?) throw DeviceFailure(failure);
    if (cancelPicker) return null;
    return DevicePhoto(photo, mimeType: mimeType, name: 'photo');
  }

  @override
  Future<TryOnCamera> openCamera({String? deviceId}) async {
    await Future<void>.delayed(Duration.zero);
    if (cameraFailure case final failure?) throw DeviceFailure(failure);
    opened++;
    return _ScriptedCamera(this, deviceId ?? cameras.first);
  }
}

final class _ScriptedCamera implements TryOnCamera {
  _ScriptedCamera(this._devices, this.selected);
  final ScriptedDevices _devices;
  final _lost = Completer<DeviceException>();

  @override
  final String selected;

  @override
  List<String> get available => _devices.cameras;

  @override
  bool get mirrored => selected == 'front';

  @override
  Future<DevicePhoto> capture() async {
    _devices.captures++;
    return DevicePhoto(_devices.photo, mimeType: _devices.mimeType);
  }

  @override
  Future<void> close() async => _devices.closed++;

  @override
  Future<DeviceException> get lost => _lost.future;

  @override
  Widget preview(BuildContext context) => const ColoredBox(
    color: Color(0xFF8A8A8A),
    child: Center(
      child: Text('camera', style: TextStyle(color: Color(0xFFFFFFFF))),
    ),
  );
}
