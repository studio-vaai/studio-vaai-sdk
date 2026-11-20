/// A scripted studio vaai API, for tests and demos without a network.
///
/// Pass it as [StudioVaai]'s transport: it answers the requests the core
/// builds for one product in sizes M and L, records them, and lets a test
/// change the answer for one route (`overrides['POST /bodies'] = ...`).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'studio_vaai.dart';

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
  final Map<String, HttpResponse Function(HttpRequest)> overrides = {};
  int _revision = 0;
  int _tryOns = 0;

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
    if (override != null) return override(request);
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
      'POST /bodies' => json(201, {
        'body': {
          'bodyId': bodyId,
          'createdAt': '2026-11-16T10:00:00Z',
          'estimatedHeightCm': estimatedHeightCm,
          'sourceImageUrl': 'https://images.example.test/body.webp',
          'sourceImageUrlExpiresAt': _inOneHour(),
        },
      }),
      'PATCH /bodies/$bodyId/height' => json(200, {'bodyRevisionId': 'revision-${++_revision}'}),
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
