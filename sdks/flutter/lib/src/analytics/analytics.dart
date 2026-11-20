import 'dart:async';
import 'dart:math';
import 'dart:ui' show PlatformDispatcher;

import '../experience/try_on_event.dart';
import '../generated/api.dart';
import '../transport.dart';
import 'version.dart';

/// The default collector, as the web's.
const defaultAnalyticsBaseUrl = 'https://a.studio-vaai.com';

/// A product added to the cart or ordered, by the shop's product ID and the
/// variant's foreign IDs by axis (`size`, `colorway`, and any other axis).
final class CommerceAnalyticsEvent {
  const CommerceAnalyticsEvent({required this.productId, required this.foreignIds});

  final String productId;
  final Map<String, String> foreignIds;
}

/// studio vaai analytics for the try-on, the counterpart of the web SDK's
/// `createTryOnAnalytics` (`@studio-vaai/core/analytics`): it maps the
/// experience's events to the collector's catalogue and sends them with the
/// shop's public client key, never with the shopper's session.
///
/// Pass it as a `StudioVaaiTryOn`'s `analytics` to observe the experience;
/// report the shop's own facts with [entrypointImpression], [cartItemAdded],
/// [orderPlaced] and [experimentAssigned]. Every event is sent only while
/// `enabled()` holds (the shop's consent state), checked when it happens
/// and again when it is sent. Sending is best effort and never throws.
abstract interface class TryOnAnalytics {
  /// Maps the events [subscribe] delivers; call the returned function to
  /// stop. A `StudioVaaiTryOn` given this analytics does it for you.
  void Function() observe(
    void Function() Function(void Function(TryOnExperienceEvent event)) subscribe,
  );

  /// The try-on entry point (a button, a badge) was shown for a product.
  void entrypointImpression(String productId, String entry);
  void cartItemAdded(CommerceAnalyticsEvent event);
  void orderPlaced(CommerceAnalyticsEvent event);

  /// The shopper's assignment in the try-on experiment.
  void experimentAssigned(bool enabled);

  /// Stops sending new events. Events already happening are still sent,
  /// among them the final ones of an experience disposed in the same frame.
  void dispose();
}

/// Creates [TryOnAnalytics] for the shop's public [clientApiKey].
///
/// [visitorId] defaults to [analyticsVisitorId]: random, kept in memory only,
/// and replaced every UTC day, as on the web. [sdkVersion] identifies the
/// integration; it defaults to this package (`studio_vaai@<version>`).
TryOnAnalytics createTryOnAnalytics({
  required String clientApiKey,
  required bool Function() enabled,
  String? sdkVersion,
  String baseUrl = defaultAnalyticsBaseUrl,
  String Function()? visitorId,
  HttpTransport? transport,
  Map<String, String> Function()? context,
}) => _TryOnAnalytics(
  clientApiKey: clientApiKey,
  enabled: enabled,
  sdkVersion: sdkVersion ?? studioVaaiSdkVersion,
  baseUrl: baseUrl,
  visitorId: visitorId ?? analyticsVisitorId,
  transport: transport,
  context: context ?? analyticsDeviceContext,
);

({String day, String id})? _visitor;

/// The visitor ID the web uses: random, in memory only, new every UTC day.
String analyticsVisitorId() {
  final day = DateTime.now().toUtc().toIso8601String().substring(0, 10);
  final visitor = _visitor;
  if (visitor != null && visitor.day == day) return visitor.id;
  final id = _uuid4();
  _visitor = (day: day, id: id);
  return id;
}

String _uuid4() {
  final random = Random.secure();
  final bytes = [for (var i = 0; i < 16; i++) random.nextInt(256)];
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = [for (final b in bytes) b.toRadixString(16).padLeft(2, '0')].join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// What the web reads from the browser that an app has too: the device's
/// language and its screen in logical pixels. No page, title or referrer.
Map<String, String> analyticsDeviceContext() {
  final dispatcher = PlatformDispatcher.instance;
  final display = dispatcher.displays.firstOrNull;
  return {
    'language': dispatcher.locale.toLanguageTag(),
    if (display != null && display.devicePixelRatio > 0)
      'screen':
          '${(display.size.width / display.devicePixelRatio).round()}x'
          '${(display.size.height / display.devicePixelRatio).round()}',
  };
}

final class _TryOnAnalytics implements TryOnAnalytics {
  _TryOnAnalytics({
    required this.clientApiKey,
    required this.enabled,
    required this.sdkVersion,
    required this.baseUrl,
    required this.visitorId,
    required this.context,
    required this._transport,
  });

  final String clientApiKey;
  final bool Function() enabled;
  final String sdkVersion;
  final String baseUrl;
  final String Function() visitorId;
  final Map<String, String> Function() context;
  final HttpTransport? _transport;
  final _inFlight = <Future<void>>{};
  ApiClient? _client;
  IoHttpTransport? _ownTransport;
  bool _disposed = false;
  bool _releasing = false;

  ApiClient _connect() => _client ??= ApiClient(
    config: ClientConfig(baseUrl: baseUrl, clientApiKey: clientApiKey),
    transport: _transport ?? (_ownTransport = IoHttpTransport()),
  );

  _Context _eventContext() {
    final id = visitorId();
    final device = context();
    return _Context(
      id: id.length > 50 ? id.substring(0, 50) : id,
      language: device['language'],
      screen: device['screen'],
    );
  }

  Future<void> _deliver(AnalyticsEvent payload) async {
    try {
      final api = _connect();
      if (enabled()) {
        await api.sendAnalyticsEvent(body: AnalyticsEventRequest(payload: payload));
      }
    } catch (_) {
      // Analytics is best effort and never delays the shop.
    }
  }

  void _send(AnalyticsEvent Function() event) {
    if (_disposed || !enabled()) return;
    late final Future<void> work;
    work = _deliver(event()).whenComplete(() => _inFlight.remove(work));
    _inFlight.add(work);
  }

  AnalyticsProductData _product(String productId) =>
      AnalyticsProductData(productId: productId, sdkVersion: sdkVersion);

  AnalyticsVariantData _variant(String productId, Map<String, String> foreignIds) =>
      AnalyticsVariantData(
        productId: productId,
        sdkVersion: sdkVersion,
        variantSize: foreignIds['size'],
        variantColorway: foreignIds['colorway'],
        additional: {
          for (final MapEntry(:key, :value) in foreignIds.entries)
            if (key != 'size' && key != 'colorway') 'variant-$key': value,
        },
      );

  @override
  void Function() observe(
    void Function() Function(void Function(TryOnExperienceEvent event)) subscribe,
  ) => subscribe(_map);

  void _map(TryOnExperienceEvent event) {
    final d = event.detail;
    final productId = event.productId;
    final c = _eventContext();
    final step = _step(event.step);
    void operation(String work, String outcome, [String? reason]) => _send(
      () => ExperienceOperationFailedAnalyticsEvent(
        ExperienceOperationFailed(
          id: c.id,
          language: c.language,
          screen: c.screen,
          data: ExperienceOperationFailedData(
            productId: productId,
            sdkVersion: sdkVersion,
            work: work,
            outcome: outcome,
            reason: reason,
            currentStep: step,
          ),
        ),
      ),
    );
    switch (event.type) {
      case 'sv-try-on-opened':
        final entry = d['entry'] as String?;
        if (entry != null) {
          _send(
            () => EntrypointClickedAnalyticsEvent(
              EntrypointClicked(
                id: c.id,
                language: c.language,
                screen: c.screen,
                data: EntrypointClickedData(
                  productId: productId,
                  sdkVersion: sdkVersion,
                  entry: entry,
                  subentry: d['subentry'] as String?,
                  currentStep: step,
                ),
              ),
            ),
          );
        }
      case 'sv-try-on-step-changed':
        final previous = d['previousStep'] as String?;
        final source = previous == null ? EntryAnalyticsStep() : _step(previous);
        switch (event.step) {
          case 'intro':
            _send(
              () => IntroOpenedAnalyticsEvent(
                IntroOpened(
                  id: c.id,
                  language: c.language,
                  screen: c.screen,
                  data: IntroOpenedData(
                    productId: productId,
                    sdkVersion: sdkVersion,
                    source: source,
                  ),
                ),
              ),
            );
          case 'height':
            _send(
              () => HeightEnteredAnalyticsEvent(
                HeightEntered(
                  id: c.id,
                  language: c.language,
                  screen: c.screen,
                  data: HeightEnteredData(
                    productId: productId,
                    sdkVersion: sdkVersion,
                    source: source,
                  ),
                ),
              ),
            );
          case 'variant-selection':
            _send(
              () => VariantSelectionInitiatedAnalyticsEvent(
                VariantSelectionInitiated(
                  id: c.id,
                  language: c.language,
                  screen: c.screen,
                  data: VariantSelectionInitiatedData(
                    productId: productId,
                    sdkVersion: sdkVersion,
                    source: source,
                  ),
                ),
              ),
            );
        }
      case 'sv-try-on-consent-granted':
        _send(
          () => ConsentGrantedAnalyticsEvent(
            ConsentGranted(
              id: c.id,
              language: c.language,
              screen: c.screen,
              data: _product(productId),
            ),
          ),
        );
      case 'sv-try-on-photo-source-started':
        final source = _imageSource(d['originStep'] as String?);
        _send(
          () => d['source'] == 'camera'
              ? ImageRecordInitiatedAnalyticsEvent(
                  ImageRecordInitiated(
                    id: c.id,
                    language: c.language,
                    screen: c.screen,
                    data: ImageRecordInitiatedData(
                      productId: productId,
                      sdkVersion: sdkVersion,
                      source: source,
                    ),
                  ),
                )
              : ImageUploadInitiatedAnalyticsEvent(
                  ImageUploadInitiated(
                    id: c.id,
                    language: c.language,
                    screen: c.screen,
                    data: ImageUploadInitiatedData(
                      productId: productId,
                      sdkVersion: sdkVersion,
                      source: source,
                    ),
                  ),
                ),
        );
      case 'sv-try-on-photo-source-cancelled':
        final source = _imageSource(d['originStep'] as String?);
        _send(
          () => d['source'] == 'camera'
              ? ImageRecordAbortedAnalyticsEvent(
                  ImageRecordAborted(
                    id: c.id,
                    language: c.language,
                    screen: c.screen,
                    data: ImageRecordAbortedData(
                      productId: productId,
                      sdkVersion: sdkVersion,
                      source: source,
                    ),
                  ),
                )
              : ImageUploadAbortedAnalyticsEvent(
                  ImageUploadAborted(
                    id: c.id,
                    language: c.language,
                    screen: c.screen,
                    data: ImageUploadAbortedData(
                      productId: productId,
                      sdkVersion: sdkVersion,
                      source: source,
                    ),
                  ),
                ),
        );
      case 'sv-try-on-photo-accepted':
        _send(
          () => ImageUploadedAnalyticsEvent(
            ImageUploaded(
              id: c.id,
              language: c.language,
              screen: c.screen,
              data: ImageUploadedData(
                productId: productId,
                sdkVersion: sdkVersion,
                imageSource: d['source'] == 'camera'
                    ? RecordSelfTimerImageUploadedDataImageSource()
                    : SelectImageUploadedDataImageSource(),
              ),
            ),
          ),
        );
      case 'sv-try-on-requested':
        _send(
          () => TryOnInitiatedAnalyticsEvent(
            TryOnInitiated(
              id: c.id,
              language: c.language,
              screen: c.screen,
              data: _variant(productId, _foreignIds(d)),
            ),
          ),
        );
      case 'sv-try-on-closed':
        _send(
          () => ViewClosedAnalyticsEvent(
            ViewClosed(
              id: c.id,
              language: c.language,
              screen: c.screen,
              data: ViewClosedData(productId: productId, sdkVersion: sdkVersion, currentStep: step),
            ),
          ),
        );
      case 'sv-try-on-session-failed':
        operation('session', 'failed', d['reason'] as String?);
      case 'sv-try-on-height-failed':
        operation('height', 'failed', d['reason'] as String?);
      case 'sv-try-on-operation-slow':
        operation(d['work']! as String, 'in_progress', 'slow');
      case 'sv-try-on-operation-deadline':
        operation(d['work']! as String, 'failed', 'deadline');
      case 'sv-try-on-operation-uncertain':
        operation(d['work']! as String, 'uncertain');
      case 'sv-try-on-camera-failed':
        operation('camera', 'failed', d['reason'] as String?);
      case 'sv-try-on-capture-failed':
        operation('capture', 'failed', d['reason'] as String?);
      case 'sv-try-on-picker-failed':
        operation('picker', 'failed', d['reason'] as String?);
      case 'sv-try-on-photo-failed':
        operation('photo', 'failed', d['reason'] as String?);
      case 'sv-try-on-failed':
        operation('try-on', 'failed', d['reason'] as String?);
      case 'sv-try-on-detached':
        operation('try-on', 'detached', d['stage'] as String?);
      default:
        // Processing, rejections, presentation, rendering, variant changes and
        // the cart request carry nothing the catalogue records, as on the web.
        break;
    }
  }

  @override
  void entrypointImpression(String productId, String entry) {
    final c = _eventContext();
    _send(
      () => EntrypointImpressionAnalyticsEvent(
        EntrypointImpression(
          id: c.id,
          language: c.language,
          screen: c.screen,
          data: EntrypointImpressionData(
            productId: productId,
            sdkVersion: sdkVersion,
            entry: entry,
          ),
        ),
      ),
    );
  }

  @override
  void cartItemAdded(CommerceAnalyticsEvent event) {
    final c = _eventContext();
    _send(
      () => CartItemAddedAnalyticsEvent(
        CartItemAdded(
          id: c.id,
          language: c.language,
          screen: c.screen,
          data: _variant(event.productId, event.foreignIds),
        ),
      ),
    );
  }

  @override
  void orderPlaced(CommerceAnalyticsEvent event) {
    final c = _eventContext();
    _send(
      () => OrderPlacedAnalyticsEvent(
        OrderPlaced(
          id: c.id,
          language: c.language,
          screen: c.screen,
          data: _variant(event.productId, event.foreignIds),
        ),
      ),
    );
  }

  @override
  void experimentAssigned(bool enabled) {
    final c = _eventContext();
    _send(
      () => ExperimentAssignedAnalyticsEvent(
        ExperimentAssigned(
          id: c.id,
          language: c.language,
          screen: c.screen,
          data: ExperimentAssignedData(
            sdkVersion: sdkVersion,
            variant: enabled
                ? EnabledExperimentAssignedDataVariant()
                : DisabledExperimentAssignedDataVariant(),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    if (_disposed || _releasing) return;
    _releasing = true;
    // An experience disposed in the same frame still publishes its final
    // events (a detached operation, the closed view) synchronously after
    // this call, as React's cleanups run: take those, then stop.
    scheduleMicrotask(() {
      _disposed = true;
      unawaited(_release());
    });
  }

  Future<void> _release() async {
    await Future.wait([..._inFlight]);
    _client?.dispose();
    _ownTransport?.close();
  }
}

Map<String, String> _foreignIds(Map<String, Object?> detail) =>
    (detail['foreignIds'] as Map?)?.cast<String, String>() ?? const {};

AnalyticsStep _step(String step) => switch (step) {
  'intro' => IntroAnalyticsStep(),
  'camera' => ImageRecordAnalyticsStep(),
  'photo-upload' => ImageUploadAnalyticsStep(),
  'photo-rejected' => ImageRejectionAnalyticsStep(),
  'height' => HeightAnalyticsStep(),
  'variant-selection' => VariantSelectionAnalyticsStep(),
  _ => TryOnAnalyticsStep(),
};

AnalyticsImageSource _imageSource(String? step) => switch (step) {
  'height' => HeightAnalyticsImageSource(),
  'variant-selection' || 'try-on' => VariantSelectionAnalyticsImageSource(),
  'photo-rejected' => ImageRejectionAnalyticsImageSource(),
  _ => IntroAnalyticsImageSource(),
};

final class _Context {
  const _Context({required this.id, this.language, this.screen});
  final String id;
  final String? language, screen;
}
