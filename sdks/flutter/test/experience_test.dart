import 'dart:async';
import 'dart:convert';
import 'dart:io';
// TryOnExperience without widgets: the real core's default flow, driven as
// the widgets drive it, against ScriptedApi and scripted devices.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:studio_vaai/studio_vaai.dart';
import 'package:studio_vaai/testing.dart';
import 'package:studio_vaai/widgets.dart';

import 'support/describe.dart';
import 'support/fakes.dart';
import 'package:studio_vaai/core.dart' as core;

final class _Host implements TryOnRendererHost {
  final carts = <CartRequest>[];
  final downloads = <(Uint8List, String)>[];
  @override
  Future<void> addToCart(CartRequest request) async => carts.add(request);
  @override
  Future<void> download(Uint8List bytes, String mimeType) async => downloads.add((bytes, mimeType));
}

/// The core's resize target for a decoded size, or null to keep the original.
(int, int)? photoEncodingPlanFor(int width, int height) => switch (core.photoEncodingPlan(
  decoded: core.UploadedPhotoSize(width: width, height: height),
)) {
  core.ResizeJpegPhotoEncodingPlan(:final width, :final height) => (width, height),
  _ => null,
};

/// The fixtures stay in the repository: the published package ships no test data.
final _noFixtures = File('test/fixtures/guide.heic').existsSync() ? false : 'no test fixtures';

void main() {
  late ScriptedApi api;
  late StudioVaai sdk;
  late ScriptedDevices devices;

  setUp(() {
    api = ScriptedApi();
    sdk = StudioVaai(clientApiKey: 'sv_client_test', baseUrl: ScriptedApi.baseUrl, transport: api);
    devices = ScriptedDevices();
  });
  tearDown(() => sdk.dispose());

  Future<void> settle(TryOnExperience e, bool Function(FlowView) done) async {
    for (var i = 0; i < 400 && !done(e.view); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(done(e.view), isTrue, reason: describe(e.view));
  }

  Future<TryOnExperience> create() => TryOnExperience.create(
    sdk: sdk,
    product: const TryOnProductReference.id(ScriptedApi.productId),
    presentProduct: scriptedPresentation,
    devices: devices,
  );

  Future<TryOnExperience> consented() async {
    final e = await create();
    addTearDown(e.dispose);
    e.attachRenderer(_Host(), foreground: true, canAddToCart: false);
    expect(e.open(), isTrue);
    await settle(e, (v) => v.domain.session != SessionPhase.restoring);
    e.dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));
    return e;
  }

  test('the default flow from consent to a presented try-on, cart and download', () async {
    final e = await create();
    addTearDown(e.dispose);
    final events = <ExperienceEvent>[];
    e.events.listen(events.add);
    final host = _Host();
    expect(e.attachRenderer(host, foreground: true, canAddToCart: true), isNotNull);
    expect(e.readyInstallation(const TryOnProductReference.id(ScriptedApi.productId)), isNotNull);
    expect(e.open(), isTrue);
    expect(e.view.screen, isA<IntroductionScreenView>());
    await settle(e, (v) => v.domain.session != SessionPhase.restoring);

    e.dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));
    e.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.library_)));
    expect(e.view.modal, isA<PickerModal>());
    await settle(e, (v) => v.screen is HeightScreenView);
    expect((e.view.screen as HeightScreenView).draft, 172);
    // The photo went up through the core's upload helper.
    expect(api.sent('PUT upload'), hasLength(1));

    e.dispatchShopper(HeightFlowAction(EditHeightAction(180)));
    e.dispatchShopper(HeightFlowAction(ConfirmHeightAction()));
    await settle(e, (v) => v.screen is TryOnScreenView);
    final screen = e.view.screen as TryOnScreenView;
    expect(screen.presentation.mode, PresentationMode.selection);
    final primary = screen.presentation.primaryAction as TryPrimaryTryOnAction;
    expect(primary.variantId, ScriptedApi.variantM);

    e.dispatchShopper(PresentationFlowAction(RunPrimaryPresentationAction(primary.variantId)));
    await settle(e, (v) => v.renderMedia?.result?.asset != null);
    final result = e.view.renderMedia!.result!;
    final tryOnId = (result.target as ResultImageTarget).tryOnId;
    expect(e.assetSource(result), 'https://images.example.test/try-on-1.webp');
    expect(e.view.journey.presented, isFalse);
    // The flow presents the result once the renderer decoded its image.
    e.imageDecoded(result, ready: true);
    await settle(e, (v) => v.journey.presented && v.renderMedia!.cart.available);
    expect(e.view.renderMedia!.download.available, isTrue);

    api.overrides['GET /try-on-1.webp'] = (_) => HttpResponse(
      status: 200,
      headers: [HttpHeader(name: 'content-type', value: 'image/webp')],
      body: Uint8List(4),
    );
    e.dispatchShopper(RenderMediaFlowAction(DownloadRenderMediaAction(tryOnId)));
    await settle(e, (_) => host.downloads.isNotEmpty);
    expect(host.downloads.single.$2, 'image/webp');

    e.dispatchShopper(
      SelectionFlowAction(
        RequestResultCartSelectionAction(tryOnId: tryOnId, variantId: ScriptedApi.variantM),
      ),
    );
    await settle(e, (_) => host.carts.isNotEmpty);
    expect(host.carts.single.variantId, ScriptedApi.variantM);
    // A successful add to the bag closes the experience, as on the web.
    await settle(e, (v) => !v.presence.open);

    expect(
      events.map((x) => x.fact),
      containsAll([
        isA<ConsentGrantedExperienceFact>(),
        isA<PhotoExperienceFact>(),
        isA<TryOnRequestedExperienceFact>(),
        isA<TryOnRenderedExperienceFact>(),
        isA<TryOnResolvedExperienceFact>(),
        isA<AddToCartRequestedExperienceFact>(),
      ]),
    );
  });

  test('a result image that does not decode is recovered, not left loading', () async {
    final e = await consented();
    e.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.library_)));
    await settle(e, (v) => v.screen is HeightScreenView);
    e.dispatchShopper(HeightFlowAction(ConfirmHeightAction()));
    await settle(e, (v) => v.screen is TryOnScreenView);
    final primary =
        (e.view.screen as TryOnScreenView).presentation.primaryAction as TryPrimaryTryOnAction;
    e.dispatchShopper(PresentationFlowAction(RunPrimaryPresentationAction(primary.variantId)));
    await settle(e, (v) => v.renderMedia?.result?.asset != null);
    e.imageDecoded(e.view.renderMedia!.result!, ready: false);
    expect(e.view.renderMedia!.result!.phase, isNot(ImagePhase.loading));
    await settle(e, (v) => v.renderMedia?.result?.phase != ImagePhase.recovering);
    expect(e.failure, isNull);
  });

  test('another product installs in the same session, with its commerce', () async {
    final e = await create();
    addTearDown(e.dispose);
    e.attachRenderer(_Host(), foreground: true, canAddToCart: false);
    final ok = await e.installProduct(
      const TryOnProductReference.id(ScriptedApi.productId),
      scriptedPresentation,
      commerce: {ScriptedApi.variantL: const VariantCommerce(price: '€10', inStock: false)},
    );
    expect(ok, isTrue);
    expect(e.prices, {ScriptedApi.variantL: '€10'});
    expect(e.view.domain.unavailableVariants, [ScriptedApi.variantL]);
    e.updateCommerce({ScriptedApi.variantL: const VariantCommerce(inStock: true)});
    expect(e.view.domain.unavailableVariants, isEmpty);
  });

  test('a product the API does not have reports as unavailable', () async {
    api.overrides['GET /products/${ScriptedApi.productId}'] = (_) =>
        ScriptedApi.problem(404, 'not-found');
    await expectLater(create(), throwsA(predicate(isTryOnProductUnavailable)));
  });

  test('the camera: acquire, switch, release on close', () async {
    final e = await consented();
    e.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.camera)));
    bool live(FlowView v) =>
        v.screen is CameraScreenView && (v.screen as CameraScreenView).camera is LiveCameraState;
    await settle(e, live);
    final lease = ((e.view.screen as CameraScreenView).camera as LiveCameraState).lease;
    expect(e.camera(lease)?.selected, 'front');
    expect((e.view.screen as CameraScreenView).canSwitch, isTrue);

    e.dispatchShopper(CameraFlowAction(SwitchCameraAction()));
    await settle(
      e,
      (v) => live(v) && ((v.screen as CameraScreenView).camera as LiveCameraState).lease != lease,
    );
    final switched = ((e.view.screen as CameraScreenView).camera as LiveCameraState).lease;
    expect(e.camera(switched)?.selected, 'back');
    expect(devices.closed, 1);

    e.close();
    await settle(e, (v) => !v.presence.open);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(devices.closed, 2);
  });

  test('photo preparation keeps a small photo; empty input is refused', () async {
    final prepared = await preparePhotoForUpload(scriptedPhoto, 'image/png');
    expect(prepared.mimeType, 'image/png');
    expect(prepared.bytes, scriptedPhoto);
    await expectLater(
      preparePhotoForUpload(Uint8List(0), 'image/png'),
      throwsA(isA<PhotoInputException>()),
    );
  });

  test('photo preparation downscales a large photo to JPEG, as the core plans', () async {
    final large = img.Image(width: 3000, height: 4000);
    img.fill(large, color: img.ColorRgb8(180, 120, 90));
    final png = img.encodePng(large, level: 1);
    final prepared = await preparePhotoForUpload(png, 'image/png');
    final plan = photoEncodingPlanFor(3000, 4000);
    if (plan == null) {
      expect(prepared.bytes, png);
    } else {
      expect(prepared.mimeType, 'image/jpeg');
      final decoded = img.decodeJpg(prepared.bytes)!;
      expect((decoded.width, decoded.height), plan);
    }
  });

  test('a HEIC photo is decoded by the platform and uploaded as JPEG', skip: _noFixtures, () async {
    // Our own artwork, saved as HEIC with macOS sips (test/fixtures/guide.heic).
    final heic = File('test/fixtures/guide.heic').readAsBytesSync();
    final prepared = await preparePhotoForUpload(heic, 'image/heic');
    expect(prepared.mimeType, 'image/jpeg');
    final decoded = img.decodeJpg(prepared.bytes)!;
    expect((decoded.width, decoded.height), (599, 900));
    expect(prepared.metadata?.uploaded?.width, 599);
  });

  test(
    'a HEIC photo the platform cannot decode is refused, never uploaded as is',
    skip: _noFixtures,
    () async {
      // A HEIF container with nothing decodable in it.
      final broken = Uint8List.fromList([
        ...File('test/fixtures/guide.heic').readAsBytesSync().take(64),
        ...List.filled(512, 0),
      ]);
      await expectLater(
        preparePhotoForUpload(broken, 'image/heic'),
        throwsA(anyOf(isA<UnsupportedPhotoException>(), isA<PhotoInputException>())),
      );
    },
  );

  test('a HEIC photo picked in the flow goes up as JPEG', skip: _noFixtures, () async {
    devices
      ..photo = File('test/fixtures/guide.heic').readAsBytesSync()
      ..mimeType = 'image/heic';
    final e = await consented();
    e.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.library_)));
    await settle(e, (v) => v.screen is HeightScreenView);
    final upload = api.sent('PUT upload').single.body!;
    expect(upload.sublist(0, 3), [0xFF, 0xD8, 0xFF]);
  });

  group('the kept session', () {
    late MemoryTryOnSessionStore store;
    setUp(() => store = MemoryTryOnSessionStore());

    Future<TryOnExperience> launch() async {
      final e = await TryOnExperience.create(
        sdk: sdk,
        product: const TryOnProductReference.id(ScriptedApi.productId),
        presentProduct: scriptedPresentation,
        devices: devices,
        sessionStore: store,
      );
      e.attachRenderer(_Host(), foreground: true, canAddToCart: false);
      expect(e.open(), isTrue);
      await settle(e, (v) => v.domain.session != SessionPhase.restoring);
      return e;
    }

    StoredTryOnSession? stored() => StoredTryOnSession.decode(store.values[sdk.sessionKey]);

    test('a relaunch restores the session, the photo and the height', () async {
      final first = await launch();
      expect(first.view.domain.session, SessionPhase.absent);
      first.dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));
      first.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.library_)));
      await settle(first, (v) => v.screen is HeightScreenView);
      first.dispatchShopper(HeightFlowAction(EditHeightAction(181)));
      first.dispatchShopper(HeightFlowAction(ConfirmHeightAction()));
      await settle(first, (v) => v.screen is TryOnScreenView);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(stored()?.token, 'bearer-1');
      expect(stored()?.bodyId, ScriptedApi.bodyId);
      expect(stored()?.bodySource, PhotoSource.library_);
      first.dispose();

      // The next launch: no new session, the API verifies the stored one.
      final second = await launch();
      addTearDown(second.dispose);
      expect(second.view.domain.session, SessionPhase.ready);
      expect(api.sent('POST /session/bearer'), hasLength(1));
      expect(api.sent('GET /session'), hasLength(1));
      final verify = api.sent('GET /session').single.headers;
      expect(verify.any((h) => h.value == 'Bearer bearer-1'), isTrue);
      // The body and its photo (the API's signed URL) are back, at the height set.
      expect(second.view.domain.photo?.source, PhotoSource.library_);
      expect(
        second.view.domain.body,
        isA<LiveBodyState>().having((b) => b.identity.bodyId, 'body', ScriptedApi.bodyId),
      );
      final media = second.view.domain.photo!.media;
      expect(second.photo(media)?.url, 'https://images.example.test/body.webp');
      // The shopper goes on from where they were: no new photo.
      second.dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));
      expect(api.sent('POST /bodies'), hasLength(1));
    });

    test('an expired session is wiped, not restored', () async {
      store.values[sdk.sessionKey] = const StoredTryOnSession(
        token: 'old',
        expiresAtMs: 1000,
        bodyId: ScriptedApi.bodyId,
        bodySource: PhotoSource.camera,
      ).encode();
      final e = await launch();
      addTearDown(e.dispose);
      expect(e.view.domain.session, SessionPhase.absent);
      expect(store.values, isEmpty);
      expect(api.sent('GET /session'), isEmpty);
    });

    test('a session the API no longer knows is wiped', () async {
      store.values[sdk.sessionKey] = StoredTryOnSession(
        token: 'revoked',
        expiresAtMs: DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch.toDouble(),
      ).encode();
      api.overrides['GET /session'] = (_) => HttpResponse(
        status: 401,
        headers: [HttpHeader(name: 'content-type', value: 'application/problem+json')],
        body: Uint8List.fromList(
          utf8.encode(
            jsonEncode({
              'type': 'about:blank',
              'kind': 'session-invalid',
              'title': 'Session invalid',
              'status': 401,
            }),
          ),
        ),
      );
      final e = await launch();
      addTearDown(e.dispose);
      expect(e.view.domain.session, isNot(SessionPhase.ready));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(store.values, isEmpty);
    });

    test('withdrawing consent while the session is created keeps nothing', () async {
      final gate = Completer<void>();
      api.overrides['POST /session/bearer'] = (_) async {
        await gate.future;
        return ScriptedApi.json(201, {
          'token': 'bearer-late',
          'expiresAt': DateTime.now().toUtc().add(const Duration(hours: 1)).toIso8601String(),
        });
      };
      final e = await launch();
      addTearDown(e.dispose);
      e.dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));
      // The library starts the session once a photo is chosen.
      e.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.library_)));
      await settle(e, (v) => v.domain.session == SessionPhase.creating);
      // The shopper withdraws consent before the API answers.
      e.dispatchShopper(SessionFlowAction(SetConsentSessionAction(false)));
      await settle(e, (v) => v.domain.session == SessionPhase.absent);
      gate.complete();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(e.view.domain.session, SessionPhase.absent);
      expect(store.values, isEmpty);
    });

    test('keepSession off keeps nothing', () async {
      final e = await TryOnExperience.create(
        sdk: sdk,
        product: const TryOnProductReference.id(ScriptedApi.productId),
        presentProduct: scriptedPresentation,
        devices: devices,
      );
      addTearDown(e.dispose);
      e.attachRenderer(_Host(), foreground: true, canAddToCart: false);
      e.open();
      await settle(e, (v) => v.domain.session != SessionPhase.restoring);
      e.dispatchShopper(SessionFlowAction(SetConsentSessionAction(true)));
      e.dispatchShopper(PhotoFlowAction(BeginSourcePhotoAction(PhotoSource.library_)));
      await settle(e, (v) => v.screen is HeightScreenView);
      expect(store.values, isEmpty);
    });
  });
}
