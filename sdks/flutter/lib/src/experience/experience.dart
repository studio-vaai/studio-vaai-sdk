import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../generated/api.dart'
    show HttpRequest, ProblemApiException, ProductDetails, UnexpectedStatusApiException;
import '../generated/state_machine.dart';
import '../generated/studio_vaai_core.dart' as core;
import '../session.dart';
import 'devices.dart';
import 'photo_preparation.dart';
import 'product.dart';
import 'session_store.dart';
import 'try_on_event.dart';

/// What the renderer does for the flow: the work that needs the widget tree.
abstract interface class TryOnRendererHost {
  /// The storefront adds the variant to the cart; throws when it cannot.
  Future<void> addToCart(CartRequest request);

  /// Hands a downloaded try-on image to the host; throws when it cannot.
  Future<void> download(Uint8List bytes, String mimeType);
}

/// A photo the experience holds while the flow or the domain retains it.
final class TryOnPhoto {
  TryOnPhoto(DevicePhoto this.original) : bodyId = null;

  /// A restored session's photo: the API's signed URL of the body's source.
  TryOnPhoto.remote(String this.url, this.expiresAtMs, String this.bodyId)
    : original = null,
      asset = newUuid();

  final DevicePhoto? original;
  bool flow = false, domain = false;
  Future<PreparedPhoto>? prepared;

  /// The signed URL, its expiry, and the asset ID it is shown under.
  String? url;
  double? expiresAtMs;
  String? asset;
  final String? bodyId;
}

/// One shopper's default try-on experience: the shared Rust session, its
/// default flow and its exclusive effect driver, wired to the API through
/// the core's helpers and to the device through [TryOnDevices].
///
/// The flow decides everything; this class starts the work its effects ask
/// for, reports how it ended, and publishes each new [view]. It mirrors the
/// web adapter (`@studio-vaai/web-components` `TryOnExperience`).
final class TryOnExperience extends ChangeNotifier {
  TryOnExperience._(
    this._sdk,
    this.devices,
    FlowConfig config,
    InitialProductInstallation initial,
    this._productDetails,
    this._installedForeignId,
    this._prices,
    TryOnSessionStore? sessionStore,
  ) : _session = TryOnSession(config: SessionConfig(runtimeId: newUuid(), maxTryOnRequests: 64)) {
    try {
      _flow = DefaultTryOnFlow.withInstallation(
        session: _session,
        config: config,
        initial: initial,
      );
    } catch (_) {
      _session.dispose();
      rethrow;
    }
    _driver = _session.claimEffectDriver();
    _jobs = ExperienceJobRunner(
      _sdk,
      session: _session,
      credentialRefreshed: (revision) {
        // The refresh rotated the token: keep the new one for the next launch.
        unawaited(_jobs.persistCredential());
        _domainCommand(SessionDomainCommand(CredentialRefreshedSessionCommand(revision)));
      },
      photo: _preparedPhoto,
      store: sessionStore,
      restoredPhoto: _registerRemote,
    );
    _view = _flow.view();
    _drain();
  }

  /// Looks up the product, then starts the experience for it.
  static Future<TryOnExperience> create({
    required StudioVaai sdk,
    required TryOnProductReference product,
    required PresentProduct presentProduct,
    required TryOnDevices devices,
    AutoStartPolicy autoStart = AutoStartPolicy.never,
    Map<String, VariantCommerce>? commerce,
    bool active = true,
    TryOnSessionStore? sessionStore,
  }) async {
    final details = await product.lookup(sdk);
    final presentation = productPresentationFor(details, presentProduct);
    final resolved = resolveCommerce(presentation.commerce, commerce);
    return TryOnExperience._(
      sdk,
      devices,
      FlowConfig(hostProduct: presentation.hostProduct, autoStart: autoStart),
      InitialProductInstallation(
        token: newUuid(),
        active: active,
        unavailableVariants: resolved.unavailable,
      ),
      details,
      product.foreignId,
      (initial: presentation.commerce, prices: resolved.prices),
      sessionStore,
    );
  }

  final StudioVaai _sdk;

  /// The camera and photo library.
  final TryOnDevices devices;
  final TryOnSession _session;
  late final DefaultTryOnFlow _flow;
  late final EffectDriver _driver;
  late final ExperienceJobRunner _jobs;
  late FlowView _view;
  ProductDetails? _productDetails;
  String? _installedForeignId;
  ({Map<String, VariantCommerce>? initial, Map<String, String> prices})? _prices;

  final _events = StreamController<ExperienceEvent>.broadcast(sync: true);
  final _tryOnEvents = StreamController<TryOnExperienceEvent>.broadcast(sync: true);
  final _photos = <MediaId, TryOnPhoto>{};
  final _cameras = <LeaseId, TryOnCamera>{};
  final _pending = <InteractionToken, void Function()>{};
  final _mediaWork = <InteractionToken, _Cancel>{};
  final _jobTimers = <Timer>{};
  final _assets = <String, ({InteractionToken id, String src})>{};
  TryOnRendererHost? _renderer;
  InteractionToken? _rendererToken;
  bool _draining = false;
  bool _disposed = false;
  bool _notifyPending = false;
  Object? _failure;
  bool _failureVisible = false;

  /// What the flow shows now.
  FlowView get view => _view;

  /// Why the experience ended unexpectedly, if it did.
  Object? get failure => _failure;

  /// Whether the "ended unexpectedly" notice is showing.
  bool get failureVisible => _failureVisible;

  bool get isDisposed => _disposed;

  /// The shopper's journey, as the web's `sv-try-on-*` events: the same
  /// facts, from the same core projection.
  Stream<ExperienceEvent> get events => _events.stream;

  /// The same journey as the web's `sv-try-on-*` DOM events ([TryOnExperienceEvent]),
  /// with the web's operation timing: what analytics maps.
  Stream<TryOnExperienceEvent> get tryOnEvents => _tryOnEvents.stream;

  void _publish(ExperienceEvent event) {
    _events.add(event);
    final projected = tryOnExperienceEventOf(event);
    if (projected != null) _tryOnEvents.add(projected);
  }

  /// Formatted prices of the installed product, by variant ID.
  Map<String, String> get prices => _prices?.prices ?? const {};

  /// A photo the flow or domain holds, by media ID.
  TryOnPhoto? photo(MediaId id) => _photos[id];

  /// The live camera of a lease.
  TryOnCamera? camera(LeaseId lease) => _cameras[lease];

  /// The source of an image view: the photo's media ID, or the try-on's URL.
  String? imageSource(ImageView image) => switch (image.target) {
    SourceImageTarget(:final media) => switch (_photos[media]) {
      null => null,
      TryOnPhoto(:final url?) => url,
      _ => 'media:$media',
    },
    ResultImageTarget(:final tryOnId) => _session.tryOnAsset(id: tryOnId)?.imageUrl,
    _ => null,
  };

  /// The installation token of the ready product, when it is [product].
  InteractionToken? readyInstallation(TryOnProductReference product) {
    final installation = _view.productInstallation;
    final matches = product.foreignId != null
        ? _installedForeignId == product.foreignId
        : installation?.productId == product.productId;
    return _failure == null && !_disposed && matches ? _view.readyInstallation : null;
  }

  // --- The renderer ----------------------------------------------------

  /// Attaches the widget that renders the flow; returns its token.
  InteractionToken? attachRenderer(
    TryOnRendererHost host, {
    required bool foreground,
    required bool canAddToCart,
  }) {
    if (_disposed) return null;
    final token = _commit(
      () => _flow
          .dispatch(
            action: RenderMediaFlowAction(
              AttachRenderMediaAction(foreground: foreground, canAddToCart: canAddToCart),
            ),
          )
          .view
          .renderer,
    );
    _renderer = host;
    _rendererToken = token;
    _observeImages();
    return token;
  }

  void detachRenderer(InteractionToken token) {
    if (_rendererToken != token) return;
    dispatch(RenderMediaFlowAction(DetachRenderMediaAction(token)));
    _renderer = null;
    _rendererToken = null;
  }

  void setCartAvailable(bool available) {
    final token = _rendererToken;
    if (token == null) return;
    dispatch(
      RenderMediaFlowAction(
        SetCartAvailableRenderMediaAction(renderer: token, available: available),
      ),
    );
  }

  /// The renderer decoded (or failed to decode) an image the flow showed.
  void imageDecoded(ImageView image, {required bool ready}) {
    final current = _currentImage(image.target);
    final version = image.version;
    if (current == null ||
        version == null ||
        current.token != image.token ||
        current.version != version ||
        current.load != image.load) {
      return;
    }
    dispatch(
      RenderMediaFlowAction(
        ImageDecodedRenderMediaAction(
          target: image.target,
          token: image.token,
          version: version,
          ready: ready,
        ),
      ),
    );
  }

  ImageView? _currentImage(ImageTarget target) {
    final media = _view.renderMedia;
    final image = target is SourceImageTarget ? media?.source : media?.result;
    if (image == null) return null;
    return switch ((image.target, target)) {
      (SourceImageTarget(media: final a), SourceImageTarget(media: final b)) when a == b => image,
      (ResultImageTarget(tryOnId: final a), ResultImageTarget(tryOnId: final b)) when a == b =>
        image,
      _ => null,
    };
  }

  /// Gives each image the flow shows an asset ID for its current source, as
  /// the web renderer does, so the flow knows which bytes a decode reports.
  void _observeImages() {
    if (_disposed || _rendererToken == null) return;
    final media = _view.renderMedia;
    final retained = <String>{
      for (final t in _view.domain.tryOns) 'result:${t.id}',
      if (_view.domain.photo case final photo?) 'photo:${photo.media}',
    };
    for (final image in [media?.source, media?.result]) {
      if (image == null) continue;
      final key = switch (image.target) {
        SourceImageTarget(:final media) => 'photo:$media',
        ResultImageTarget(:final tryOnId) => 'result:$tryOnId',
        _ => null,
      };
      if (key == null) continue;
      retained.add(key);
      final src = imageSource(image);
      if (src == null || src.isEmpty) continue;
      var asset = _assets[key];
      // A restored photo is shown under the asset ID its signed URL has.
      final signed = switch (image.target) {
        SourceImageTarget(:final media) => _photos[media]?.asset,
        _ => null,
      };
      if (asset == null || asset.src != src || (signed != null && signed != asset.id)) {
        asset = (id: signed ?? newUuid(), src: src);
        _assets[key] = asset;
      }
      if (image.asset != asset.id) {
        _dispatchRenderer(
          RenderMediaFlowAction(
            ImageAssetObservedRenderMediaAction(
              target: image.target,
              token: image.token,
              asset: asset.id,
            ),
          ),
        );
      }
    }
    _assets.removeWhere((key, _) => !retained.contains(key));
  }

  /// The source the renderer should show for an image view, once observed.
  String? assetSource(ImageView image) {
    final asset = image.asset;
    if (asset == null) return null;
    for (final value in _assets.values) {
      if (value.id == asset) return value.src;
    }
    return null;
  }

  // --- Host actions ------------------------------------------------------

  /// Opens the flow; false when it cannot open now.
  bool open([JourneyEntry? entry]) {
    if (_disposed || _failure != null) return false;
    try {
      _commit(() => _flow.dispatch(action: OpenWithEntryFlowAction(entry ?? JourneyEntry())));
      return !_disposed && _view.presence.open;
    } on RejectedTryOnException {
      return false;
    }
  }

  void close() {
    if (_failureVisible) {
      _failureVisible = false;
      _notify();
      return;
    }
    dispatch(PresenceFlowAction(PresenceAction.close));
  }

  /// The app went to the background, or came back.
  void setForeground(bool foreground) {
    if (_view.presence.foreground == foreground) return;
    dispatch(PresenceFlowAction(foreground ? PresenceAction.resume : PresenceAction.suspend));
  }

  void setProductActive(bool active) =>
      dispatch(SelectionFlowAction(SetProductActiveSelectionAction(active)));

  /// Reports stock: the variants the storefront cannot sell.
  void setUnavailableVariants(List<String> variantIds) => dispatch(
    SelectionFlowAction(
      SetUnavailableVariantsSelectionAction(
        variantIds: variantIds,
        installation: _view.readyInstallation,
      ),
    ),
  );

  /// Live prices and stock for the installed product.
  void updateCommerce(Map<String, VariantCommerce>? commerce) {
    if (_disposed || _failure != null) return;
    final resolved = resolveCommerce(_prices?.initial, commerce);
    final pricesChanged = !mapEquals(resolved.prices, _prices?.prices);
    _prices = (initial: _prices?.initial, prices: resolved.prices);
    final before = _view;
    setUnavailableVariants(resolved.unavailable);
    if (pricesChanged && identical(before, _view)) _notify();
  }

  /// Installs another product in this experience, keeping the shopper's
  /// session, photo and height: as the web's `installProduct`.
  Future<bool> installProduct(
    TryOnProductReference product,
    PresentProduct presentProduct, {
    Map<String, VariantCommerce>? commerce,
  }) async {
    if (_disposed) return false;
    ProductDetails? details;
    if (product.foreignId != null) {
      details = _installedForeignId == product.foreignId ? _productDetails : null;
      if (details == null) {
        close();
        details = await product.lookup(_sdk);
      }
    } else if (_productDetails?.productId == product.productId) {
      details = _productDetails;
    }
    if (_disposed) return false;
    final productId = details?.productId ?? product.productId!;
    final request = newUuid();
    final ProductInstallation? installation = _commit<ProductInstallation?>(
      () => _flow
          .dispatch(
            action: SelectionFlowAction(
              BeginProductInstallationSelectionAction(productId: productId, token: request),
            ),
          )
          .view
          .productInstallation,
    );
    if (installation == null || _disposed) return false;
    final token = installation.token;
    ProductInstallation? finish([HostProduct? hostProduct, List<String> unavailable = const []]) {
      if (_disposed) return null;
      return _commit<ProductInstallation?>(
        () => _flow
            .dispatch(
              action: SelectionFlowAction(
                FinishProductInstallationSelectionAction(
                  token: token,
                  hostProduct: hostProduct,
                  unavailableVariants: unavailable,
                ),
              ),
            )
            .view
            .productInstallation,
      );
    }

    try {
      details ??= await product.lookup(_sdk);
      if (_disposed) return false;
      final presentation = productPresentationFor(details, presentProduct);
      final resolved = resolveCommerce(presentation.commerce, commerce);
      _productDetails = details;
      _installedForeignId = product.foreignId;
      final installed = finish(presentation.hostProduct, resolved.unavailable);
      final ready =
          installed?.token == token && installed?.status == ProductInstallationStatus.ready;
      if (ready) _prices = (initial: presentation.commerce, prices: resolved.prices);
      return ready;
    } catch (_) {
      finish();
      rethrow;
    }
  }

  /// Dispatches an action from the shopper: a refused one becomes feedback
  /// in the flow (the web's `dispatchShopper`).
  void dispatchShopper(FlowAction action) {
    if (_disposed) return;
    final token = _rendererToken;
    _commit(
      () => token == null
          ? _flow.dispatchShopper(action: action)
          : _flow.dispatchFromRenderer(renderer: token, action: action, shopper: true),
    );
  }

  void dispatch(FlowAction action) {
    if (_disposed) return;
    _commit(() => _flow.dispatch(action: action));
  }

  void _dispatchRenderer(FlowAction action) {
    final token = _rendererToken;
    if (_disposed || token == null) return;
    _commit(() => _flow.dispatchFromRenderer(renderer: token, action: action, shopper: false));
  }

  void completeDevice(DeviceEvent event) {
    if (_disposed) return;
    _commit(() => _flow.completeDevice(event: event));
  }

  void _domainCommand(DomainCommand command) {
    if (_disposed) return;
    _commit(() => _session.command(command: command));
  }

  // --- The effect driver -------------------------------------------------

  T? _commit<T>(T Function() input) {
    T result;
    try {
      result = input();
    } on QueueFullTryOnException {
      if (_draining) rethrow;
      _drain();
      if (_disposed) return null;
      result = input();
    }
    _drain();
    return result;
  }

  void _drain() {
    if (_draining || _disposed) return;
    _draining = true;
    var changed = false;
    try {
      for (var batch = _driver.nextBatch(); batch != null; batch = _driver.nextBatch()) {
        final after = batch.flow?.after;
        try {
          for (final effect in batch.effects) {
            _start(effect, after);
          }
        } catch (error, stack) {
          _driver.halt(batchId: batch.id);
          _draining = false;
          _fail(error, stack, after);
          return;
        }
        _driver.acknowledge(batchId: batch.id);
        if (after != null) {
          _view = after;
          changed = true;
        }
        for (final event in batch.experienceEvents) {
          _publish(event);
        }
      }
    } catch (error, stack) {
      _draining = false;
      _fail(error, stack);
      return;
    } finally {
      _draining = false;
    }
    if (changed) {
      _observeImages();
      _notify();
    }
  }

  void _notify() {
    if (_disposed && !_failureVisible) return;
    // Listeners rebuild widgets; never while a transition is being delivered.
    if (_notifyPending) return;
    _notifyPending = true;
    scheduleMicrotask(() {
      _notifyPending = false;
      if (hasListeners) notifyListeners();
    });
  }

  void _start(Effect effect, FlowView? view) {
    switch (effect) {
      case DomainEffectEffect(effect: StartDomainEffect(:final operation, :final job)):
        // Started now, reported when it ends; acknowledging does not wait for it.
        unawaited(_runJob(operation, job));
      case DomainEffectEffect(effect: CancelDomainEffect()):
        // Requests already sent settle on their own; the flow ignores a late outcome.
        break;
      case DomainEffectEffect(effect: MediaDomainEffect(:final effect)):
        _media(effect, domain: true);
      case DomainEffectEffect(effect: PersistBodyDomainEffect(:final bodyId, :final source)):
        unawaited(_jobs.persistBody(bodyId, source));
      case DomainEffectEffect(effect: SessionDomainEffect(:final effect)):
        // As the web: persist keeps the session; clear forgets it on the device
        // too (expiry, a reset, a withdrawn consent); release only lets go.
        switch (effect) {
          case SessionEffect.persist:
            unawaited(_jobs.persistCredential());
          case SessionEffect.clear:
            _jobs.clear();
            unawaited(_jobs.forget());
          case SessionEffect.release:
            _jobs.clear();
        }
      case DeviceEffectEffect(:final effect):
        _device(effect);
      default:
        // Domain and flow events reach hosts through the batch's experience events.
        break;
    }
  }

  Future<void> _runJob(OperationId operation, Job job) async {
    // As the web: a photo slower than 10 s or a try-on slower than 30 s is
    // reported, and one still running at the core's budget missed its deadline.
    final work = switch (job) {
      PhotoJobVariant() => 'photo',
      TryOnJobVariant() => 'try-on',
      _ => null,
    };
    final timers = <Timer>{};
    void report(String type) {
      final productId = _view.productInstallation?.productId ?? _productDetails?.productId;
      if (_disposed || productId == null || work == null) return;
      _tryOnEvents.add(
        TryOnExperienceEvent(type, {
          'productId': productId,
          'step': work == 'photo' ? 'photo-upload' : 'try-on',
          'work': work,
        }),
      );
    }

    if (work != null) {
      timers
        ..add(
          Timer(
            Duration(seconds: work == 'photo' ? 10 : 30),
            () => report('sv-try-on-operation-slow'),
          ),
        )
        ..add(
          Timer(
            Duration(milliseconds: core.experienceJobTimeoutMs(job: job)),
            () => report('sv-try-on-operation-deadline'),
          ),
        );
    }
    _jobTimers.addAll(timers);
    final Outcome outcome;
    try {
      outcome = await _jobs.run(job);
    } finally {
      for (final timer in timers) {
        timer.cancel();
      }
      _jobTimers.removeAll(timers);
    }
    if (_disposed) return;
    try {
      _commit(
        () => _session.complete(
          completion: Completion(operation: operation, outcome: outcome),
        ),
      );
    } catch (error, stack) {
      _fail(error, stack);
    }
  }

  Future<PreparedPhoto?> _preparedPhoto(MediaId media) async {
    final original = _photos[media]?.original;
    if (original == null) return null;
    return _photos[media]!.prepared ??= preparePhotoForUpload(original.bytes, original.mimeType);
  }

  void _device(DeviceEffect effect) {
    switch (effect) {
      case MediaDeviceEffect(:final effect):
        _media(effect, domain: false);
      case PickerDeviceEffect(effect: OpenPickerEffect(:final token)):
        unawaited(_finish(_pick(token)));
      case PickerDeviceEffect(effect: DismissPickerEffect(:final token)):
        _pending.remove(token)?.call();
      case CameraDeviceEffect(effect: AcquireCameraEffect(:final token, :final deviceId)):
        unawaited(_finish(_acquire(token, deviceId)));
      case CameraDeviceEffect(effect: CancelAcquireCameraEffect(:final token)):
        _pending.remove(token)?.call();
      case CameraDeviceEffect(effect: ReleaseCameraEffect(:final lease)):
        _releaseCamera(lease);
      case CameraDeviceEffect(effect: ScheduleTimerCameraEffect(:final token, :final deadline)):
        _timer(token, deadline);
      case CameraDeviceEffect(effect: CancelTimerCameraEffect(:final token)):
        _pending.remove(token)?.call();
      case CameraDeviceEffect(effect: CaptureFrameCameraEffect(:final token, :final lease)):
        unawaited(_finish(_capture(token, lease)));
      case CartDeviceEffect(:final request):
        unawaited(_cart(request));
      case RenderMediaDeviceEffect(:final effect):
        _renderMedia(effect);
      default:
        break;
    }
  }

  Future<void> _finish(Future<DeviceEvent?> work) async {
    try {
      final event = await work;
      if (event != null && !_disposed) completeDevice(event);
    } catch (error, stack) {
      _fail(error, stack);
    }
  }

  MediaId _register(DevicePhoto photo) {
    final id = newUuid();
    _photos[id] = TryOnPhoto(photo);
    return id;
  }

  void _media(MediaEffect effect, {required bool domain}) {
    final (media, retain) = switch (effect) {
      RetainMediaEffect(:final media) => (media, true),
      ReleaseMediaEffect(:final media) => (media, false),
      _ => (null, false),
    };
    final photo = _photos[media];
    if (photo == null) return;
    if (domain) {
      photo.domain = retain;
    } else {
      photo.flow = retain;
    }
    if (!photo.flow && !photo.domain) _photos.remove(media);
  }

  Future<DeviceEvent?> _pick(InteractionToken token) async {
    var dismissed = false;
    _pending[token] = () => dismissed = true;
    try {
      final picked = await devices.pickPhoto();
      if (dismissed || _disposed) return null;
      if (picked == null) return PickerDeviceEvent(CancelledPickerEvent(token));
      return PickerDeviceEvent(SelectedPickerEvent(token: token, media: _register(picked)));
    } on DeviceFailure catch (failure) {
      return dismissed
          ? null
          : PickerDeviceEvent(FailedPickerEvent(token: token, error: failure.error));
    } catch (_) {
      return dismissed
          ? null
          : PickerDeviceEvent(FailedPickerEvent(token: token, error: DeviceException.failed));
    } finally {
      _pending.remove(token);
    }
  }

  Future<DeviceEvent?> _acquire(InteractionToken token, String? deviceId) async {
    var cancelled = false;
    _pending[token] = () => cancelled = true;
    try {
      final camera = await devices.openCamera(deviceId: deviceId);
      if (cancelled || _disposed) {
        unawaited(camera.close());
        return null;
      }
      final lease = newUuid();
      _cameras[lease] = camera;
      unawaited(
        camera.lost.then((error) {
          if (_cameras.containsKey(lease) && !_disposed) {
            _releaseCamera(lease);
            completeDevice(CameraDeviceEvent(LostCameraEvent(lease: lease, error: error)));
          }
        }),
      );
      return CameraDeviceEvent(
        AcquiredCameraEvent(
          token: token,
          lease: lease,
          preview: CameraPreview.ready,
          devices: CameraDevices(selected: camera.selected, available: camera.available),
        ),
      );
    } on DeviceFailure catch (failure) {
      return cancelled
          ? null
          : CameraDeviceEvent(AcquireFailedCameraEvent(token: token, error: failure.error));
    } finally {
      _pending.remove(token);
    }
  }

  void _releaseCamera(LeaseId lease) {
    final camera = _cameras.remove(lease);
    if (camera != null) unawaited(camera.close());
  }

  void _timer(InteractionToken token, MonotonicMillis deadline) {
    final timer = Timer(Duration(milliseconds: max(0, deadline - monotonicNow())), () {
      _pending.remove(token);
      // The timer fired at its deadline; never report an earlier time.
      final now = max(monotonicNow(), deadline);
      completeDevice(CameraDeviceEvent(TimerElapsedCameraEvent(token: token, now: now)));
    });
    _pending[token] = timer.cancel;
  }

  Future<DeviceEvent?> _capture(InteractionToken token, LeaseId lease) async {
    final camera = _cameras[lease];
    try {
      if (camera == null) throw const DeviceFailure(DeviceException.interrupted);
      final photo = await camera.capture();
      if (_disposed || _cameras[lease] != camera) return null;
      return CameraDeviceEvent(FrameCapturedCameraEvent(token: token, media: _register(photo)));
    } on DeviceFailure catch (failure) {
      return CameraDeviceEvent(CaptureFailedCameraEvent(token: token, error: failure.error));
    } catch (_) {
      return CameraDeviceEvent(
        CaptureFailedCameraEvent(token: token, error: DeviceException.failed),
      );
    }
  }

  Future<void> _cart(CartRequest request) async {
    await Future<void>.value();
    var added = false;
    try {
      final host = _renderer;
      if (host != null) {
        await host.addToCart(request);
        added = true;
      }
    } catch (_) {
      // The storefront reports failure through the cart outcome.
    }
    if (_disposed) return;
    try {
      completeDevice(CartDeviceEvent(CartEvent(token: request.token, added: added)));
    } catch (error, stack) {
      _fail(error, stack);
    }
  }

  void _renderMedia(RenderMediaEffect effect) {
    switch (effect) {
      case ObserveSourceRenderMediaEffect(:final media):
        // A restored photo's signed URL expires: the flow renews it in time.
        final photo = _photos[media];
        final (asset, expires) = (photo?.asset, photo?.expiresAtMs);
        if (asset != null && expires != null && expires.isFinite) {
          dispatch(
            RenderMediaFlowAction(
              SourceAssetObservedRenderMediaAction(
                media: media,
                asset: asset,
                expiresAt: max(0, expires.round()),
                now: DateTime.now().millisecondsSinceEpoch,
              ),
            ),
          );
        }
      case PrepareSourceRenderMediaEffect(:final media, :final asset):
        if (_photos[media]?.asset == asset) unawaited(_refreshPhoto(media));
      case CancelRenderMediaEffect(:final work):
        _mediaWork.remove(work)?.cancel();
      case RecoverRenderMediaEffect(:final image, :final work):
        unawaited(_runMedia(work, () => _recover(image)));
      case RenewForDownloadRenderMediaEffect(:final image, :final work):
        unawaited(_runMedia(work, () => _renewResult(image)));
      case DownloadRenderMediaEffect(:final image, :final work):
        unawaited(_runMedia(work, () => _download(image)));
      default:
        break;
    }
  }

  Future<void> _runMedia(InteractionToken work, Future<RenderMediaOutcome> Function() run) async {
    final cancel = _Cancel();
    _mediaWork[work] = cancel;
    var outcome = RenderMediaOutcome.failed;
    try {
      outcome = await run().timeout(Duration(milliseconds: renderMediaTimeoutMs()));
    } catch (_) {
      // A failure for this work only; the flow decides whether it is still current.
    } finally {
      _mediaWork.remove(work);
    }
    if (cancel.cancelled || _disposed) return;
    try {
      completeDevice(RenderMediaDeviceEvent(RenderMediaEvent(work: work, outcome: outcome)));
    } catch (error, stack) {
      _fail(error, stack);
    }
  }

  MediaId _registerRemote(String url, double expiresAtMs, String bodyId) {
    final id = newUuid();
    _photos[id] = TryOnPhoto.remote(url, expiresAtMs, bodyId);
    return id;
  }

  /// Renews a restored photo's signed URL through the core (the web's
  /// `refreshPhoto`), under a new asset ID.
  Future<bool> _refreshPhoto(MediaId media) async {
    final photo = _photos[media];
    final bodyId = switch (_view.domain.body) {
      LiveBodyState(:final identity) || MissingBodyState(:final identity) => identity.bodyId,
      _ => photo?.bodyId,
    };
    if (photo == null || photo.url == null || bodyId == null || bodyId.isEmpty) return false;
    try {
      final renewal = await _jobs.renewImage(core.PhotoExperienceImageTarget(bodyId));
      if (renewal is! core.RenewedExperienceImageRenewal || _disposed || _photos[media] != photo) {
        return false;
      }
      photo
        ..url = renewal.url
        ..expiresAtMs = renewal.expiresAtMs ?? photo.expiresAtMs
        ..asset = newUuid();
      _observeImages();
      _notify();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<RenderMediaOutcome> _recover(ImageView image) async {
    if (image.target case SourceImageTarget(:final media)) {
      await _refreshPhoto(media);
    }
    if (image.target is ResultImageTarget) {
      try {
        await _renewResult(image);
      } catch (_) {
        // The current URL may still work when retried.
      }
    }
    _observeImages();
    return RenderMediaOutcome.succeeded;
  }

  /// Renews a try-on's signed image URL through the core, then tells the
  /// session the new URL for the same asset.
  Future<RenderMediaOutcome> _renewResult(ImageView image) async {
    final target = image.target;
    if (target is! ResultImageTarget) return RenderMediaOutcome.failed;
    final current = _session.tryOnAsset(id: target.tryOnId);
    if (current == null) return RenderMediaOutcome.failed;
    final renewal = await _jobs.renewImage(
      core.ResultExperienceImageTarget(
        tryOnId: target.tryOnId,
        variant: current.key.variantId,
        bodyRevision: current.backendRevision,
      ),
    );
    if (_disposed) return RenderMediaOutcome.failed;
    switch (renewal) {
      case core.RenewedExperienceImageRenewal(:final url):
        _domainCommand(
          TryOnDomainCommand(ReplaceImageTryOnCommand(expected: current, imageUrl: url)),
        );
        _observeImages();
        return RenderMediaOutcome.succeeded;
      case core.EndedExperienceImageRenewal(:final outcome):
        if (outcome is SessionExpiredOutcome || outcome is CredentialRejectedOutcome) {
          return RenderMediaOutcome.failed;
        }
        return RenderMediaOutcome.failed;
      default:
        return RenderMediaOutcome.failed;
    }
  }

  Future<RenderMediaOutcome> _download(ImageView image) async {
    final src = assetSource(image) ?? imageSource(image);
    final host = _renderer;
    if (src == null || host == null || !src.startsWith('http')) return RenderMediaOutcome.failed;
    final response = await _sdk.transport.send(
      HttpRequest(method: 'GET', url: src, headers: const [], body: null, withCredentials: false),
    );
    if (response.status < 200 || response.status >= 300) {
      return classifyDownloadFailure(status: response.status, canRenew: true);
    }
    final type = response.headers
        .where((h) => h.name.toLowerCase() == 'content-type')
        .map((h) => h.value.split(';').first.trim())
        .firstOrNull;
    await host.download(response.body, type ?? mimeTypeOf(null, response.body));
    return RenderMediaOutcome.succeeded;
  }

  // --- Failure and disposal ------------------------------------------------

  void _fail(Object error, [StackTrace? stack, FlowView? failedView]) {
    if (_disposed || _failure != null) return;
    _failure = error;
    final before = _view;
    _failureVisible = (failedView ?? before).presence.open;
    if (!_draining) {
      try {
        _flow.dispatch(action: PresenceFlowAction(PresenceAction.dispose));
        _drain();
      } catch (_) {
        // If Rust cannot commit a close, the host still releases its resources.
      }
    }
    final closedInFlow = before.presence.open && !_view.presence.open;
    if (!closedInFlow) {
      final fact = experienceCloseAfterHostFailure(before: before);
      if (fact != null) _publish(fact);
    }
    _release();
    FlutterError.reportError(
      FlutterErrorDetails(exception: error, stack: stack, library: 'studio_vaai'),
    );
    _notify();
  }

  void _release() {
    _disposed = true;
    for (final cancel in _pending.values) {
      cancel();
    }
    _pending.clear();
    for (final work in _mediaWork.values) {
      work.cancel();
    }
    for (final timer in _jobTimers) {
      timer.cancel();
    }
    _jobTimers.clear();
    for (final camera in _cameras.values) {
      unawaited(camera.close());
    }
    _cameras.clear();
    _photos.clear();
    _renderer = null;
    _jobs.dispose();
    _driver.dispose();
    _flow.dispose();
    _session.dispose();
    unawaited(_events.close());
    unawaited(_tryOnEvents.close());
  }

  @override
  void dispose() {
    if (!_disposed) {
      try {
        _commit(() => _flow.dispatch(action: PresenceFlowAction(PresenceAction.dispose)));
        if (!_disposed) {
          _session.command(command: SessionDomainCommand(DisposeSessionCommand()));
          _drain();
        }
      } catch (_) {
        // Release the resources regardless.
      } finally {
        if (!_disposed) _release();
      }
    }
    super.dispose();
  }
}

final class _Cancel {
  bool cancelled = false;
  void cancel() => cancelled = true;
}

final _clock = Stopwatch()..start();

/// The monotonic clock the flow's camera timer runs on, in milliseconds.
int monotonicNow() => _clock.elapsedMilliseconds;

final _random = Random.secure();

/// A random (version 4) UUID.
String newUuid() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = [for (final byte in b) byte.toRadixString(16).padLeft(2, '0')].join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// Whether an error is the API saying the product has no try-on.
bool isTryOnProductUnavailable(Object error) => switch (error) {
  ProblemApiException(status: 404) || UnexpectedStatusApiException(status: 404) => true,
  _ => false,
};
