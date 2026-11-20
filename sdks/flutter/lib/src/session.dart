import 'dart:async';
import 'dart:math';
import 'dart:typed_data';

import 'generated/api.dart';
import 'generated/api.dart' as api_fns show apiVersion;
import 'generated/state_machine.dart';
import 'generated/studio_vaai_core.dart' as core;
import 'experience/session_store.dart';
import 'transport.dart';

part 'jobs.dart';

/// The studio vaai API for one shop: its public client key and where the API is.
///
/// Every request goes through [transport]: by default an [IoHttpTransport], or
/// your own [HttpTransport] (a scripted one in tests).
final class StudioVaai {
  StudioVaai({
    required String clientApiKey,
    String baseUrl = defaultBaseUrl,
    HttpTransport? transport,
    String clientName = 'studio-vaai-flutter',
  }) : this._(
         transport ?? IoHttpTransport(),
         ownsTransport: transport == null,
         config: ClientConfig(baseUrl: baseUrl, clientApiKey: clientApiKey, clientName: clientName),
       );

  StudioVaai._(this.transport, {required this._ownsTransport, required ClientConfig config})
    : _config = config,
      api = ApiClient(config: config, transport: transport);

  final ClientConfig _config;

  /// The key this shop's stored try-on session lives under.
  String get sessionKey => tryOnSessionKey(_config.baseUrl, _config.clientApiKey);

  static const defaultBaseUrl = 'https://api.studio-vaai.com';

  /// Sends every request the core builds.
  final HttpTransport transport;
  final bool _ownsTransport;

  /// The generated API client, for operations this layer does not wrap.
  final ApiClient api;

  /// The API contract version this SDK speaks (`X-Api-Version`).
  String get apiVersion => api_fns.apiVersion();

  /// A try-on product by its studio vaai product ID.
  Future<ProductDetails> product(String productId) =>
      _lookup(core.IdExperienceProductLookup(productId));

  /// A try-on product by the shop's own product ID.
  Future<ProductDetails> productByForeignId(String foreignId) =>
      _lookup(core.ForeignIdExperienceProductLookup(foreignId));

  Future<ProductDetails> _lookup(core.ExperienceProductLookup lookup) async {
    final client = api.withTransport(transport: _withBudget(core.experienceProductTimeoutMs()));
    try {
      return await core.lookupExperienceProduct(client: client, lookup: lookup);
    } finally {
      client.dispose();
    }
  }

  /// Starts a try-on session. Call it only once the shopper has consented to
  /// the processing of their photo: [consent] attests that consent.
  Future<TryOnJourney> startTryOn({required DataProcessingConsent consent}) =>
      TryOnJourney._start(this, consent);

  /// The transport for one job, failing at the job's time budget.
  HttpTransport _transportFor(Job job) => _withBudget(core.experienceJobTimeoutMs(job: job));

  /// The core sets each operation's budget; an [IoHttpTransport] enforces it.
  HttpTransport _withBudget(int milliseconds) {
    final transport = this.transport;
    if (transport is! IoHttpTransport) return transport;
    return transport.until(DateTime.now().add(Duration(milliseconds: milliseconds)));
  }

  void dispose() {
    api.dispose();
    final transport = this.transport;
    if (_ownsTransport && transport is IoHttpTransport) transport.close();
  }
}

/// The body a photo became: its ID and the height estimated from it.
typedef PhotoBody = ({String bodyId, double estimatedHeightCm});

/// An operation that did not succeed. A call the state machine refuses throws
/// its [TryOnException] (such as [RejectedTryOnException]) and changes nothing.
sealed class TryOnJourneyException implements Exception {
  const TryOnJourneyException();
}

/// The photo cannot be used for a try-on; take or pick another.
final class PhotoRejectedException extends TryOnJourneyException {
  const PhotoRejectedException(this.reason);
  final PhotoRejection reason;
  @override
  String toString() => 'Photo rejected: ${reason.name}';
}

/// The backend refused to try this variant on for this body (it does not fit).
final class TryOnRefusedException extends TryOnJourneyException {
  const TryOnRefusedException(this.refused);
  final RefusedTryOn refused;
  @override
  String toString() => 'Try-on refused: ${refused.reason}';
}

/// The operation ended without its result: [outcome] says how.
final class OperationFailedException extends TryOnJourneyException {
  const OperationFailedException(this.outcome);
  final Object outcome;
  @override
  String toString() => 'Operation failed: $outcome';
}

/// One shopper's try-on journey, headless: the shared Rust state machine
/// (`TryOnSession`) decides what happens, and this class performs the work it
/// asks for (session, photo upload, height, size recommendation, try-ons)
/// through the shared core's API helpers and your [HttpTransport].
///
/// It follows the state machine's adapter contract: one effect driver, batches
/// started in order and acknowledged, every operation's outcome reported back.
/// A UI reads [snapshot] and listens to [changes] and [events].
final class TryOnJourney {
  TryOnJourney._(this._sdk)
    : _session = TryOnSession(config: SessionConfig(runtimeId: _uuid(), maxTryOnRequests: 64)) {
    _driver = _session.claimEffectDriver();
    _jobs = ExperienceJobRunner(
      _sdk,
      session: _session,
      credentialRefreshed: (revision) {
        if (!_disposed) {
          _command(SessionDomainCommand(CredentialRefreshedSessionCommand(revision)));
        }
      },
      photo: (media) async {
        final image = _photos[media];
        return image == null ? null : originalPhoto(image.bytes, image.mimeType);
      },
    );
  }

  final StudioVaai _sdk;
  final TryOnSession _session;
  late final EffectDriver _driver;
  late final ExperienceJobRunner _jobs;

  final _changes = StreamController<DomainSnapshot>.broadcast();
  final _events = StreamController<DomainEvent>.broadcast();
  final _outcomes = <OperationId, Completer<Outcome>>{};
  final _photos = <MediaId, ({Uint8List bytes, String mimeType})>{};
  final _waiters = <_Waiter>[];
  bool _disposed = false;

  static Future<TryOnJourney> _start(StudioVaai sdk, DataProcessingConsent consent) async {
    final journey = TryOnJourney._(sdk);
    try {
      // A new session's first batch restores the stored session. Nothing is
      // stored between app launches yet, so the restore finds none.
      journey._drain();
      await journey._until(
        (s) => s.session == SessionPhase.uninitialized || s.session == SessionPhase.restoring
            ? null
            : s.session,
      );
      final created = await journey._run(SessionDomainCommand(CreateSessionCommand(consent)));
      if (journey.snapshot.session != SessionPhase.ready) {
        throw OperationFailedException(created);
      }
      return journey;
    } catch (_) {
      journey.dispose();
      rethrow;
    }
  }

  /// The domain's state: the product shown, the session, the photo and body,
  /// the size recommendation, the try-on requests and try-ons.
  DomainSnapshot get snapshot => _session.snapshot();

  /// The snapshot after each change.
  Stream<DomainSnapshot> get changes => _changes.stream;

  /// What happened in the domain, in order, such as for analytics.
  Stream<DomainEvent> get events => _events.stream;

  /// Shows a product: try-ons and the size recommendation are for it.
  void showProduct(ProductDetails details, {List<String>? unavailableVariants}) {
    final product = Product(
      id: details.productId,
      variants: [
        for (final v in details.variants) Variant(id: v.id, foreignIds: v.foreignVariantIds),
      ],
    );
    _command(
      ProductDomainCommand(
        ShowProductCommand(product: product, unavailableVariants: unavailableVariants),
      ),
    );
  }

  /// Uploads the shopper's photo and returns the body made from it.
  ///
  /// Pass the original photo (JPEG or PNG): its EXIF focal length helps the
  /// estimate. Throws [PhotoRejectedException] when the photo cannot be used.
  Future<PhotoBody> uploadPhoto(
    Uint8List bytes, {
    required String mimeType,
    PhotoSource source = PhotoSource.library_,
  }) async {
    final media = _uuid();
    _photos[media] = (bytes: bytes, mimeType: mimeType);
    final outcome = await _run(
      PhotoDomainCommand(ProcessPhotoCommand(Photo(media: media, source: source))),
    );
    return switch (outcome) {
      PhotoOutcomeVariant(outcome: final AcceptedPhotoOutcome accepted) => (
        bodyId: accepted.bodyId,
        estimatedHeightCm: accepted.estimatedHeight,
      ),
      PhotoOutcomeVariant(outcome: final RejectedPhotoOutcome rejected) =>
        throw PhotoRejectedException(rejected.reason),
      _ => throw OperationFailedException(outcome),
    };
  }

  /// Sets the body's height, in centimetres; later try-ons use it.
  Future<void> setHeight(double heightCm) async {
    final outcome = await _run(BodyDomainCommand(SetHeightBodyCommand(heightCm)));
    if (outcome is! BodyOutcomeVariant) throw OperationFailedException(outcome);
  }

  /// Tries a variant of the product shown on the body, and returns the try-on
  /// once it is made. A variant already tried on at this height returns at once.
  Future<TryOn> tryOn(String variantId) async {
    final target = switch (snapshot.body) {
      LiveBodyState(height: AcknowledgedHeightStatus(:final revision)) => AcknowledgedBodyTarget(
        revision,
      ),
      LiveBodyState(height: PendingHeightStatus(:final operation)) => PendingBodyTarget(operation),
      _ => throw StateError('Upload a photo before trying on.'),
    };
    final receipt = _command(
      TryOnDomainCommand(RequestTryOnCommand(variantId: variantId, target: target, origin: null)),
    );
    final requestId = receipt.tryOnRequestId!;
    TryOnRequestStatus? settled(DomainSnapshot s) {
      for (final request in s.tryOnRequests) {
        if (request.id == requestId) {
          final status = request.status;
          return status is WaitingTryOnRequestStatus || status is RunningTryOnRequestStatus
              ? null
              : status;
        }
      }
      return CancelledTryOnRequestStatus();
    }

    final status = await _until(settled);
    return switch (status) {
      ResolvedTryOnRequestStatus(:final tryOnId) => snapshot.tryOns.firstWhere(
        (t) => t.id == tryOnId,
      ),
      RefusedTryOnRequestStatus(tryOn: final refused) => throw TryOnRefusedException(refused),
      FailedTryOnRequestStatus(:final failure) => throw OperationFailedException(failure),
      _ => throw OperationFailedException(status),
    };
  }

  /// Ends the session's work and frees its native resources.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    final disposed = StateError('The try-on journey was disposed.');
    for (final completer in _outcomes.values) {
      completer.completeError(disposed);
    }
    for (final waiter in _waiters) {
      waiter.fail(disposed);
    }
    _outcomes.clear();
    _waiters.clear();
    _photos.clear();
    _changes.close();
    _events.close();
    _jobs.dispose();
    _driver.dispose();
    _session.dispose();
  }

  // --- The state machine's adapter --------------------------------------

  DomainReceipt _command(DomainCommand command) {
    if (_disposed) throw StateError('The try-on journey was disposed.');
    final receipt = _session.command(command: command);
    if (receipt.disposition case RejectedDisposition(:final reason)) {
      throw RejectedTryOnException(reason);
    }
    _drain();
    return receipt;
  }

  /// Runs a command that starts one operation, and returns how it ended.
  Future<Outcome> _run(DomainCommand command) {
    final operation = _command(command).operation;
    if (operation == null) throw StateError('The command started no operation.');
    // The operation's job reports asynchronously, so this is in place first.
    return (_outcomes[operation] = Completer<Outcome>()).future;
  }

  Future<T> _until<T extends Object>(T? Function(DomainSnapshot) settled) {
    final now = settled(snapshot);
    if (now != null) return Future.value(now);
    final completer = Completer<T>();
    _waiters.add(
      _Waiter((s) {
        final value = settled(s);
        if (value != null) completer.complete(value);
        return value != null;
      }, completer.completeError),
    );
    return completer.future;
  }

  /// Delivers every committed batch, in order, then acknowledges it.
  void _drain() {
    while (!_disposed) {
      final batch = _driver.nextBatch();
      if (batch == null) break;
      try {
        batch.effects.forEach(_apply);
      } catch (_) {
        _driver.halt(batchId: batch.id);
        rethrow;
      }
      _driver.acknowledge(batchId: batch.id);
    }
    if (_disposed) return;
    final current = snapshot;
    _waiters.removeWhere((waiter) => waiter.settle(current));
    _changes.add(current);
  }

  void _apply(Effect effect) {
    switch (effect) {
      case DomainEffectEffect(effect: StartDomainEffect(:final operation, :final job)):
        // Started now, reported when it ends; acknowledging does not wait for it.
        unawaited(_perform(operation, job));
      case DomainEffectEffect(effect: MediaDomainEffect(effect: ReleaseMediaEffect(:final media))):
        _photos.remove(media);
      case DomainEffectEffect(effect: SessionDomainEffect(:final effect))
          when effect != SessionEffect.persist:
        _jobs.clear();
      case DomainEventEffect(:final event):
        _events.add(event);
      default:
        // Cancel: requests already sent settle on their own. PersistBody and
        // Persist: nothing is stored between launches yet. Device effects and
        // flow events need a DefaultTryOnFlow, which this headless journey has not.
        break;
    }
  }

  Future<void> _perform(OperationId operation, Job job) async {
    final outcome = await _jobs.run(job);
    if (_disposed) return;
    final waiting = _outcomes.remove(operation);
    try {
      _session.complete(
        completion: Completion(operation: operation, outcome: outcome),
      );
      _drain();
      waiting?.complete(outcome);
    } catch (error, stack) {
      // The runtime refused the completion or an effect failed: whoever waits
      // hears it; otherwise it goes to the snapshot stream.
      if (waiting != null) {
        waiting.completeError(error, stack);
      } else if (!_disposed) {
        _changes.addError(error, stack);
      }
    }
  }
}

final class _Waiter {
  _Waiter(this.settle, this.fail);

  /// Whether the snapshot settles what this waits for; completes it if so.
  final bool Function(DomainSnapshot) settle;
  final void Function(Object) fail;
}

final _random = Random.secure();

/// A random (version 4) UUID.
String _uuid() {
  final b = List<int>.generate(16, (_) => _random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = [for (final byte in b) byte.toRadixString(16).padLeft(2, '0')].join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}
