import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import '../experience/try_on_event.dart';
import '../generated/api.dart';
import '../transport.dart';

/// The default collector, as the web's.
const defaultAnalyticsBaseUrl = 'https://a.studio-vaai.com';

/// A product added to the cart or ordered, by the shop's product ID and the
/// variant's foreign IDs by axis (`size`, `colorway`, and any other axis).
final class CommerceAnalyticsEvent {
  const CommerceAnalyticsEvent({
    required this.productId,
    required this.foreignIds,
    this.recommendedForeignIds,
    this.variantId,
  });

  final String productId;
  final String? variantId;
  final Map<String, String> foreignIds;
  final Map<String, String>? recommendedForeignIds;
}

/// studio vaai analytics for the try-on, the counterpart of the web SDK's
/// `createTryOnAnalytics` (`@studio-vaai/core/analytics`): it maps the
/// experience's events to the collector's catalogue and sends them with the
/// shop's public client key, never with the shopper's session.
///
/// Pass it as a `StudioVaaiTryOn`'s `analytics` to observe the experience;
/// report the shop's own facts with [entrypointImpression], [cartItemAdded],
/// [orderPlaced] and [experimentAssigned]. Every event is sent only while
/// `enabled()` holds. Sending is best effort.
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
/// Each request carries a random occurrence ID. The [visitorId], [context],
/// and [sdkVersion] parameters are retained for source compatibility and ignored.
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
  baseUrl: baseUrl,
  transport: transport,
);

({String day, String id})? _visitor;

/// Returns a random identifier for the current UTC day, kept in memory.
@Deprecated('Analytics uses independent occurrence IDs.')
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

const _axes = ['size', 'colorway', 'waist', 'length'];
const _limit = 32;

Map<String, Object> _variantData(
  String productId,
  String? variantId,
  Map<String, String> foreignIds,
) => {
  'product-id': productId,
  if (variantId != null)
    'variant-id': variantId
  else
    for (final axis in _axes)
      if (foreignIds[axis] case final value?) 'variant-$axis': value,
};

Map<String, String> _foreignIds(Map<String, Object?> detail) =>
    (detail['foreignIds'] as Map?)?.cast<String, String>() ?? const {};

final _catalogKey = RegExp(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$');
Map<String, String> _comparison(Map<String, String> observed, Map<String, String> recommended) {
  final values = {
    'observed-size': observed['size'] ?? observed['waist'],
    'recommended-size': recommended['size'] ?? recommended['waist'],
    'observed-length': observed['length'] ?? observed['style'],
    'recommended-length': recommended['length'] ?? recommended['style'],
  };
  return {
    for (final entry in values.entries)
      if (entry.value case final String value when _catalogKey.hasMatch(value)) entry.key: value,
  };
}

String _step(String step) => switch (step) {
  'camera' => 'image-record',
  'photo-upload' => 'image-upload',
  'photo-rejected' => 'image-rejection',
  _ => step,
};

String _imageSource(String? step) => switch (step) {
  'height' => 'height',
  'variant-selection' || 'try-on' => 'variant-selection',
  'photo-rejected' => 'image-rejection',
  _ => 'intro',
};

String _timeBucket(int seconds) => switch (seconds) {
  < 10 => 'lt-10s',
  < 30 => '10-29s',
  < 60 => '30-59s',
  < 120 => '60-119s',
  _ => '120s-plus',
};

final class _Summary {
  final requests = <String, Map<String, String>>{};
  final results = <String, Map<String, String>>{};
  final comparisons = <String>{};
  final awaitingResolution = <String, Map<String, String>>{};
  _Summary(this.productId, this.entry);
  final String productId;
  final String? entry;
  final elapsed = Stopwatch()..start();
  final variants = <String, Map<String, String>>{};
  final displayed = <String>{};
  final axes = {for (final axis in _axes) axis: <String>{}};
  bool intro = false;
  bool consent = false;
  bool photo = false;
  bool height = false;
  bool selection = false;
  bool requested = false;
  bool cart = false;
  bool missingVariant = false;
  String? timeToResult;

  void rememberVariant(String variantId, Map<String, String> foreignIds) {
    if (variants.length < _limit || variants.containsKey(variantId)) {
      variants[variantId] = foreignIds;
    }
  }

  bool present(String tryOnId, String variantId) {
    if (!displayed.add(tryOnId)) return false;
    timeToResult ??= _timeBucket(elapsed.elapsed.inSeconds);
    final variant = variants[variantId];
    missingVariant = missingVariant || variant == null;
    for (final axis in _axes) {
      final value = variant?[axis];
      final seen = axes[axis]!;
      if (value != null && seen.length < _limit) seen.add(value);
    }
    return true;
  }

  Map<String, Object> toData() => {
    'product-id': productId,
    if (entry case final value?) 'entry': value,
    'reached-intro': intro,
    'granted-consent': consent,
    'accepted-photo': photo,
    'confirmed-height': height,
    'reached-selection': selection,
    'requested-try-on': requested,
    'presented-result': displayed.isNotEmpty,
    'requested-cart': cart,
    'try-on-count': min(_limit, displayed.length),
    if (!missingVariant) ...{
      'distinct-sizes': axes['size']!.length,
      'distinct-colors': axes['colorway']!.length,
      'distinct-waists': axes['waist']!.length,
      'distinct-lengths': axes['length']!.length,
    },
    if (timeToResult case final value?) 'time-to-result': value,
  };
}

final class _TryOnAnalytics implements TryOnAnalytics {
  _TryOnAnalytics({
    required this.clientApiKey,
    required this.enabled,
    required String baseUrl,
    required HttpTransport? transport,
  }) : _endpoint = '${baseUrl.replaceFirst(RegExp(r'/$'), '')}/v2/events',
       _transport = transport;

  final String clientApiKey;
  final bool Function() enabled;
  final String _endpoint;
  final HttpTransport? _transport;
  final _inFlight = <Future<void>>{};
  IoHttpTransport? _ownTransport;
  bool _disposed = false;
  bool _releasing = false;

  Future<void> _deliver(String name, Map<String, Object> data) async {
    try {
      final transport = _transport ?? (_ownTransport ??= IoHttpTransport());
      await transport.send(
        HttpRequest(
          method: 'POST',
          url: _endpoint,
          withCredentials: false,
          headers: [
            HttpHeader(name: 'Content-Type', value: 'application/json'),
            HttpHeader(name: 'X-Client-Api-Key', value: clientApiKey),
          ],
          body: Uint8List.fromList(
            utf8.encode(
              jsonEncode({
                'eventId': _uuid4(),
                'event': {'name': name, 'data': data},
              }),
            ),
          ),
        ),
      );
    } catch (_) {
      // Analytics is best effort and never delays the shop.
    }
  }

  void _send(String name, Map<String, Object> data) {
    if (_disposed || !enabled()) return;
    late final Future<void> work;
    work = _deliver(name, data).whenComplete(() => _inFlight.remove(work));
    _inFlight.add(work);
  }

  @override
  void Function() observe(
    void Function() Function(void Function(TryOnExperienceEvent event)) subscribe,
  ) {
    _Summary? summary;
    final shopperRequests = <String, String>{};

    return subscribe((event) {
      if (_disposed || !enabled()) {
        summary = null;
        shopperRequests.clear();
        return;
      }
      final detail = event.detail;
      final productId = event.productId;
      final data = {'product-id': productId};
      final step = _step(event.step);
      final variantId = detail['variantId'] as String?;
      final existing = summary;
      if (existing != null &&
          existing.productId != productId &&
          (event.type == 'sv-try-on-step-changed' ||
              event.type == 'sv-try-on-variant-changed' ||
              event.type == 'sv-try-on-presented')) {
        summary = _Summary(productId, existing.entry);
      }
      final scope = summary?.productId == productId ? summary : null;

      void operation(String work, String outcome, [String? reason]) =>
          _send('experience-operation-failed', {
            ...data,
            'work': work,
            'outcome': outcome,
            'current-step': step,
            if (reason != null) 'reason': reason,
          });

      void reportTried(Map<String, String> pair) {
        if (scope != null &&
            scope.comparisons.length < _limit &&
            scope.comparisons.add(jsonEncode(pair))) {
          _send('size-compared', {...data, 'measure': 'tried', ...pair});
        }
      }

      switch (event.type) {
        case 'sv-try-on-opened':
          final entry = detail['entry'] as String?;
          shopperRequests.clear();
          summary = _Summary(productId, entry)
            ..intro = event.step == 'intro'
            ..selection = event.step == 'variant-selection';
          final withEntry = {...data, if (entry != null) 'entry': entry};
          _send('widget-opened', withEntry);
          if (entry != null) _send('entrypoint-clicked', withEntry);
        case 'sv-try-on-step-changed':
          final previous = detail['previousStep'] as String?;
          final stepData = {...data, 'source': previous == null ? 'entry' : _step(previous)};
          switch (event.step) {
            case 'intro':
              scope?.intro = true;
              _send('intro-opened', stepData);
            case 'height':
              _send('height-step-opened', stepData);
            case 'variant-selection':
              scope?.selection = true;
              _send('variant-selection-initiated', stepData);
          }
        case 'sv-try-on-consent-granted':
          scope?.consent = true;
          _send('consent-granted', data);
        case 'sv-try-on-photo-source-started' || 'sv-try-on-photo-source-cancelled':
          final started = event.type == 'sv-try-on-photo-source-started';
          final family = detail['source'] == 'camera' ? 'image-record' : 'image-upload';
          _send('$family-${started ? 'initiated' : 'aborted'}', {
            ...data,
            'source': _imageSource(detail['originStep'] as String?),
          });
        case 'sv-try-on-photo-accepted':
          scope?.photo = true;
          _send('image-uploaded', {
            ...data,
            'image-source': detail['source'] == 'camera' ? 'record-self-timer' : 'select',
          });
        case 'sv-try-on-photo-rejected':
          _send('photo-rejected', {
            ...data,
            'method': detail['source'] == 'camera' ? 'camera' : 'picker',
          });
        case 'sv-try-on-height-confirmed':
          scope?.height = true;
          _send('height-entered', data);
        case 'sv-try-on-variant-changed':
          final foreignIds = _foreignIds(detail);
          if (variantId != null) scope?.rememberVariant(variantId, foreignIds);
          _send('variant-changed', _variantData(productId, variantId, foreignIds));
        case 'sv-try-on-requested':
          final foreignIds = _foreignIds(detail);
          scope?.requested = true;
          if (variantId != null) scope?.rememberVariant(variantId, foreignIds);
          final requestId = detail['requestId'] as String;
          final recommended = detail['recommendedForeignIds'];
          if (scope != null && recommended is Map && scope.requests.length < _limit) {
            scope.requests[requestId] = _comparison({}, recommended.cast<String, String>());
          }
          final origin = detail['origin'] as String;
          if (origin == 'shopper') {
            if (shopperRequests.length >= _limit) {
              shopperRequests.remove(shopperRequests.keys.first);
            }
            shopperRequests[requestId] = productId;
          }
          _send('try-on-initiated', {
            ..._variantData(productId, variantId, foreignIds),
            'origin': origin,
          });
        case 'sv-try-on-presented':
          if (variantId != null && detail['foreignIds'] is Map)
            scope?.rememberVariant(variantId, _foreignIds(detail));
          if (variantId != null &&
              (scope?.present(detail['tryOnId'] as String, variantId) ?? true)) {
            final actual = _comparison(scope?.variants[variantId] ?? {}, {});
            final recommendation = scope?.results[detail['tryOnId']];
            if (recommendation != null) {
              reportTried({...recommendation, ...actual});
            } else if (scope != null && scope.awaitingResolution.length < _limit) {
              scope.awaitingResolution[detail['tryOnId'] as String] = actual;
            }
            _send('try-on-presented', {...data, 'variant-id': variantId});
          }
        case 'sv-try-on-closed':
          _send('view-closed', {
            ...data,
            'current-step': step,
            'result-displayed': detail['displayed'] != null,
          });
          if (scope != null) {
            for (final pair in scope.awaitingResolution.values) {
              reportTried(pair);
            }
            _send('experience-summary', scope.toData());
          }
          summary = null;
          shopperRequests.clear();
        case 'sv-try-on-add-to-cart-requested':
          scope?.cart = true;
          _send('cart-requested', _variantData(productId, variantId, _foreignIds(detail)));
        case 'sv-try-on-session-failed':
          operation('session', 'failed');
        case 'sv-try-on-height-failed':
          operation('height', 'failed');
        case 'sv-try-on-operation-uncertain':
          operation(detail['work'] as String, 'uncertain');
        case 'sv-try-on-operation-slow':
          operation(detail['work'] as String, 'in_progress', 'slow');
        case 'sv-try-on-operation-deadline':
          operation(detail['work'] as String, 'failed', 'deadline');
        case 'sv-try-on-camera-failed':
          operation('camera', 'failed');
        case 'sv-try-on-capture-failed':
          operation('capture', 'failed');
        case 'sv-try-on-picker-failed':
          operation('picker', 'failed');
        case 'sv-try-on-photo-failed':
          operation('photo', 'failed');
        case 'sv-try-on-failed':
          scope?.requests.remove(detail['requestId']);
          shopperRequests.remove(detail['requestId']);
          operation('try-on', 'failed');
        case 'sv-try-on-detached':
          scope?.requests.remove(detail['requestId']);
          shopperRequests.remove(detail['requestId']);
          operation('try-on', 'detached');
        case 'sv-try-on-refused':
          scope?.requests.remove(detail['requestId']);
          if (shopperRequests.remove(detail['requestId']) == productId) {
            _send('gated-size-selected', data);
          }
        case 'sv-try-on-request-resolved':
          final pair = scope?.requests.remove(detail['requestId']);
          if (scope != null && pair != null) {
            final result = detail['tryOnId'] as String;
            final actual = scope.awaitingResolution.remove(result);
            if (actual != null) {
              reportTried({...pair, ...actual});
            } else if (scope.results.length < _limit) {
              scope.results[result] = pair;
            }
          }
          shopperRequests.remove(detail['requestId']);
      }
    });
  }

  @override
  void entrypointImpression(String productId, String entry) =>
      _send('entrypoint-impression', {'product-id': productId, 'entry': entry});

  @override
  void cartItemAdded(CommerceAnalyticsEvent event) {
    _send('size-compared', {
      'product-id': event.productId,
      'measure': 'cart',
      ..._comparison(event.foreignIds, event.recommendedForeignIds ?? {}),
    });
    _send('cart-item-added', _variantData(event.productId, event.variantId, event.foreignIds));
  }

  @override
  void orderPlaced(CommerceAnalyticsEvent event) =>
      _send('order-placed', _variantData(event.productId, event.variantId, event.foreignIds));

  @override
  void experimentAssigned(bool enabled) => _send('experiment-assigned', {
    'experiment': 'try-on-enabled',
    'variant': enabled ? 'enabled' : 'disabled',
  });

  @override
  void dispose() {
    if (_disposed || _releasing) return;
    _releasing = true;
    // Include final synchronous experience events from the same frame.
    scheduleMicrotask(() {
      _disposed = true;
      unawaited(_release());
    });
  }

  Future<void> _release() async {
    await Future.wait([..._inFlight]);
    _ownTransport?.close();
  }
}
