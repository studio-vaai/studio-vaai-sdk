import 'dart:convert';
import 'dart:typed_data';

import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late ScriptedApi api;
  late StudioVaai sdk;

  setUp(() {
    api = ScriptedApi();
    sdk = StudioVaai(clientApiKey: 'sv_client_test', baseUrl: ScriptedApi.baseUrl, transport: api);
  });
  tearDown(() => sdk.dispose());

  test('the core is the native library this package bundles', () {
    expect(sdk.apiVersion, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    final metadata = readImageMetadata(image: scriptedPhoto);
    expect((metadata!.originalWidth, metadata.originalHeight), (1, 2));
  });

  test('photo bytes cross into the core borrowed, without changing them', () {
    // A large photo: the core reads only its header, from a copy the binding
    // frees after the call; the caller's bytes stay as they were.
    final photo = Uint8List(8 << 20)..setAll(0, scriptedPhoto);
    final before = Uint8List.fromList(photo.sublist(0, scriptedPhoto.length));
    for (var i = 0; i < 20; i++) {
      final metadata = readImageMetadata(image: photo);
      expect((metadata!.originalWidth, metadata.originalHeight), (1, 2));
    }
    expect(photo.sublist(0, scriptedPhoto.length), before);
    expect(readImageMetadata(image: Uint8List(0)), isNull);
  });

  test('one session: product, photo, height, try-on', () async {
    final product = await sdk.product(ScriptedApi.productId);
    expect(product.variants.map((v) => v.foreignVariantIds['size']), ['M', 'L']);

    final journey = await sdk.startTryOn(consent: DataProcessingConsent.granted);
    addTearDown(journey.dispose);
    expect(journey.snapshot.session, SessionPhase.ready);
    final created = api.sent('POST /session/bearer').single;
    expect(jsonDecode(utf8.decode(created.body!)), {'dataProcessingConsent': true});

    final events = <DomainEvent>[];
    journey.events.listen(events.add);
    journey.showProduct(product);
    expect(journey.snapshot.product?.id, ScriptedApi.productId);

    final body = await journey.uploadPhoto(scriptedPhoto, mimeType: 'image/png');
    expect(body, (bodyId: ScriptedApi.bodyId, estimatedHeightCm: 172.0));
    final upload = api.sent('PUT upload').single;
    expect(upload.body, scriptedPhoto);
    expect(upload.headers.map((h) => (h.name, h.value)), [('Content-Type', 'image/png')]);
    // The original's size travels with the upload, read by the core.
    final finalize = jsonDecode(utf8.decode(api.sent('POST /bodies').single.body!)) as Map;
    expect(finalize['stagingKey'], 'staging-1');
    expect(finalize['imageMetadata'], containsPair('originalWidth', 1));

    await journey.setHeight(180);
    final height = jsonDecode(
      utf8.decode(api.sent('PATCH /bodies/${ScriptedApi.bodyId}/height').single.body!),
    );
    expect(height, containsPair('heightCm', 180));

    final tryOn = await journey.tryOn(ScriptedApi.variantM);
    expect(tryOn.key.variantId, ScriptedApi.variantM);
    expect(tryOn.height, 180);
    expect(tryOn.imageUrl, 'https://images.example.test/try-on-1.webp');
    expect(journey.snapshot.tryOns, hasLength(1));
    // The domain announced the photo and the try-on, for analytics.
    await pumpEventQueue();
    expect(events.whereType<PhotoDomainEvent>(), isNotEmpty);
    expect(events.whereType<TryOnDomainEvent>(), isNotEmpty);

    // Every authenticated request carries the bearer session and the shop's key.
    final request = api.sent('POST /products/${ScriptedApi.productId}/try-on').single;
    final headers = {for (final h in request.headers) h.name.toLowerCase(): h.value};
    expect(headers['authorization'], 'Bearer bearer-1');
    expect(headers['x-client-api-key'], 'sv_client_test');

    // Every body the core built is still intact after the calls that freed
    // its buffers: the bindings copied it out before freeing.
    for (final request in api.requests.where((r) => r.url != ScriptedApi.uploadUrl)) {
      final body = request.body;
      if (body != null) expect(() => jsonDecode(utf8.decode(body)), returnsNormally);
    }

    // The same variant at the same height is the try-on already made.
    final again = await journey.tryOn(ScriptedApi.variantM);
    expect(again.id, tryOn.id);
    expect(api.sent('POST /products/${ScriptedApi.productId}/try-on'), hasLength(1));
  });

  test('a rejected photo is an exception, and the journey goes on', () async {
    api.overrides['POST /bodies'] = (_) => ScriptedApi.json(422, {
      'type': 'about:blank',
      'title': 'Unusable photo',
      'status': 422,
      'kind': 'body-validation-failed',
      'reason': 'no_human_detected',
    });
    final journey = await sdk.startTryOn(consent: DataProcessingConsent.granted);
    addTearDown(journey.dispose);
    journey.showProduct(await sdk.product(ScriptedApi.productId));
    await expectLater(
      journey.uploadPhoto(scriptedPhoto, mimeType: 'image/png'),
      throwsA(
        isA<PhotoRejectedException>().having(
          (e) => e.reason,
          'reason',
          PhotoRejection.noHumanDetected,
        ),
      ),
    );
    api.overrides.clear();
    final body = await journey.uploadPhoto(scriptedPhoto, mimeType: 'image/png');
    expect(body.bodyId, ScriptedApi.bodyId);
  });

  test('a refused size is an exception', () async {
    api.overrides['POST /products/${ScriptedApi.productId}/try-on'] = (_) => ScriptedApi.json(422, {
      'type': 'about:blank',
      'title': 'Garment too small',
      'status': 422,
      'kind': 'try-on-size-rejected',
      'reason': 'garment_too_small',
      'tryOnId': '0192f0e0-0000-7000-8000-0000000200ff',
    });
    final journey = await sdk.startTryOn(consent: DataProcessingConsent.granted);
    addTearDown(journey.dispose);
    journey.showProduct(await sdk.product(ScriptedApi.productId));
    await journey.uploadPhoto(scriptedPhoto, mimeType: 'image/png');
    await journey.setHeight(180);
    await expectLater(journey.tryOn(ScriptedApi.variantM), throwsA(isA<TryOnRefusedException>()));
  });

  test('without a network the session does not start', () async {
    final offline = StudioVaai(
      clientApiKey: 'k',
      baseUrl: ScriptedApi.baseUrl,
      transport: _Offline(),
    );
    addTearDown(offline.dispose);
    await expectLater(
      offline.startTryOn(consent: DataProcessingConsent.granted),
      throwsA(isA<OperationFailedException>()),
    );
  });

  test('a call the state machine refuses changes nothing', () async {
    final journey = await sdk.startTryOn(consent: DataProcessingConsent.granted);
    addTearDown(journey.dispose);
    journey.showProduct(await sdk.product(ScriptedApi.productId));
    final before = journey.snapshot;
    // No photo yet, so no body to set the height of.
    await expectLater(
      journey.setHeight(180),
      throwsA(
        isA<RejectedTryOnException>().having((e) => e.reason, 'reason', isA<NoPhotoRejection>()),
      ),
    );
    expect(journey.snapshot.body, isA<NoBodyBodyState>());
    expect(journey.snapshot.photo, before.photo);
    expect(api.sent('PATCH /bodies/${ScriptedApi.bodyId}/height'), isEmpty);
  });
}

final class _Offline implements HttpTransport {
  @override
  Future<HttpResponse> send(HttpRequest request) async => throw FailedTransportException('offline');
}
