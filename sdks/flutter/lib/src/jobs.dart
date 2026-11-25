part of 'session.dart';

/// A photo ready to upload: its bytes, its media type, and the camera
/// metadata the core read from the original before any re-encoding.
final class PreparedPhoto {
  const PreparedPhoto(this.bytes, {required this.mimeType, this.metadata});
  final Uint8List bytes;
  final String mimeType;
  final core.PhotoUploadMetadata? metadata;
}

/// Performs the jobs a session's state machine starts: the bearer session,
/// photo uploads, and everything else through the core's own API helpers, so
/// retries, error classification and credential refresh match the web.
///
/// Shared by the headless [TryOnJourney] and the ready-made widgets'
/// experience. Not part of the public API.
final class ExperienceJobRunner {
  ExperienceJobRunner(
    this._sdk, {
    required this._session,
    required void Function(int revision) credentialRefreshed,
    required this._photo,
    this._store,
    this._restoredPhoto,
  }) {
    _credentials = core.ExperienceCredentials(
      client: _sdk.api,
      host: _CredentialHost(credentialRefreshed),
    );
  }

  final StudioVaai _sdk;
  final TryOnSession _session;
  final Future<PreparedPhoto?> Function(MediaId) _photo;
  late final core.ExperienceCredentials _credentials;
  final TryOnSessionStore? _store;
  final MediaId Function(String url, double expiresAtMs, String bodyId)? _restoredPhoto;
  StoredTryOnSession? _stored;
  bool _disposed = false;

  /// The try-ons of the kept body, kept beside the session.
  late final TryOnHistory? _history = _store == null
      ? null
      : TryOnHistory(_store, tryOnHistoryKey(_sdk._config.baseUrl, _sdk._config.clientApiKey));

  /// The body a session restore brought back, until another body or none
  /// replaces it.
  String? get restoredBodyId => _restoredBodyId;
  String? _restoredBodyId;

  /// Whether the shopper's earlier photo is gone: a restore found the saved
  /// body, or its stored photo, deleted, or a renewal found it deleted while
  /// shown. Until a new photo, the flow asks for one.
  bool photoGone = false;

  // --- The stored session (the web's cookie and body selection) ------------

  /// Keeps the session's current bearer credential (after it is created or
  /// refreshed), with the body already stored.
  Future<void> persistCredential() async {
    final store = _store, bearer = _credentials.bearerCredential();
    if (store == null || bearer == null) return;
    final stored = (_stored ?? StoredTryOnSession(token: bearer.token, expiresAtMs: 0))
        .withCredential(bearer.token, bearer.expiresAtMs);
    _stored = stored;
    await store.write(_sdk.sessionKey, stored.encode());
  }

  /// Keeps the committed body, to restore it with the session.
  Future<void> persistBody(String bodyId, PhotoSource source) async {
    if (bodyId != _restoredBodyId) _restoredBodyId = null;
    photoGone = false;
    final store = _store, stored = _stored;
    if (store == null || stored == null) return;
    _stored = stored.withBody(bodyId, source);
    await store.write(_sdk.sessionKey, _stored!.encode());
  }

  /// Forgets the stored session: it ended, expired, or the shopper withdrew.
  Future<void> forget() async {
    _stored = null;
    await _store?.delete(_sdk.sessionKey);
    // A forgotten session's try-ons are not shown to the next one.
    await _history?.clear();
  }

  /// Keeps a try-on just made with the kept body, so a launch that restores
  /// the session shows it again.
  void rememberTryOn(RememberedTryOn tryOn) {
    final bodyId = _stored?.bodyId, history = _history;
    if (bodyId == null || history == null || tryOn.backendRevision.isEmpty) return;
    unawaited(history.remember(bodyId, tryOn));
  }

  /// The try-ons kept for [bodyId], oldest first.
  Future<List<RememberedTryOn>> keptTryOns(String bodyId) async =>
      await _history?.of(bodyId) ?? const [];

  /// Forgets kept try-ons the API no longer has.
  Future<void> forgetTryOns(Iterable<String> tryOnIds) async => _history?.forget(tryOnIds);

  /// Forgets every kept try-on: the body they were made with is gone.
  Future<void> forgetHistory() async => _history?.clear();

  /// The web's restore, for a bearer session: install the stored credential,
  /// have the API verify it (and report its expiry), then restore the
  /// committed body through the same core helpers as the web.
  Future<Outcome> _restore() async {
    final store = _store;
    if (store == null) return SessionOutcomeVariant(AbsentSessionOutcome());
    final stored = StoredTryOnSession.decode(await store.read(_sdk.sessionKey));
    if (stored == null || stored.expiredAt(DateTime.now())) {
      await forget();
      return SessionOutcomeVariant(AbsentSessionOutcome());
    }
    _stored = stored;
    final epoch = _credentials.beginEstablishment();
    final installed = _credentials.install(
      epoch: epoch,
      credential: core.BearerExperienceCredential(
        expiresAt: DateTime.fromMillisecondsSinceEpoch(
          stored.expiresAtMs.round(),
          isUtc: true,
        ).toIso8601String(),
        token: stored.token,
      ),
      cookieGeneration: _CredentialHost.noCookies,
    );
    if (!installed) return UnknownOutcome();
    final transport = _sdk._transportFor(SessionJobVariant(RestoreSessionJob()));
    final request = _credentials.beginRequest(transport: transport);
    if (request == null) return SessionExpiredOutcome();
    try {
      final verified = await core.restoreExperienceSession(
        credentials: _credentials,
        request: request,
        host: _Current(() => !_disposed),
      );
      if (verified case core.EndedExperienceSessionRestore(:final outcome)) {
        if (outcome is SessionExpiredOutcome || outcome is CredentialRejectedOutcome) {
          await forget();
        }
        return outcome;
      }
      // The API's expiry for the verified session.
      await persistCredential();
      final bodyId = stored.bodyId, source = stored.bodySource;
      if (bodyId == null || source == null) return SessionOutcomeVariant(ReadySessionOutcome());
      final restored = await core.restoreExperienceBody(
        credentials: _credentials,
        request: request,
        savedBodyId: bodyId,
      );
      switch (restored) {
        case core.EndedExperienceBodyRestore(:final outcome):
          return outcome;
        case core.ReadyExperienceBodyRestore(:final body?):
          _restoredBodyId = body.bodyId;
          final media = _restoredPhoto?.call(
            body.sourceImageUrl,
            body.sourceImageUrlExpiresAtMs,
            body.bodyId,
          );
          if (media == null) return SessionOutcomeVariant(ReadySessionOutcome());
          return SessionOutcomeVariant(
            RestoredSessionOutcome(
              RestoredBody(
                bodyId: body.bodyId,
                media: media,
                source: source,
                estimatedHeight: body.estimatedHeight,
                height: body.height,
                backendRevision: body.backendRevision,
              ),
            ),
          );
        default:
          // The API no longer has the body, or no longer stores its photo:
          // nothing to show or try on with. Keep the session, forget the body,
          // and ask for a new photo.
          photoGone = true;
          // Its try-on IDs are no use any more.
          await _history?.clear();
          _stored = _stored?.withBody(null, null);
          if (_stored != null) await store.write(_sdk.sessionKey, _stored!.encode());
          return SessionOutcomeVariant(ReadySessionOutcome());
      }
    } catch (_) {
      return FailedOutcome(BackendException.unavailable);
    } finally {
      request.dispose();
    }
  }

  /// Forgets the session's credential (the session ended or was cleared).
  void clear() {
    _credentials.clear();
    _restoredBodyId = null;
    photoGone = false;
  }

  /// The image URL of a try-on or the source photo, renewed through the core.
  Future<core.ExperienceImageRenewal> renewImage(core.ExperienceImageTarget target) async {
    final transport = _sdk._withBudget(core.experienceImageRenewalTimeoutMs(target: target));
    final refresh = await _credentials.refreshIfNeeded(transport: transport, nowMs: _nowMs());
    if (refresh != null) return core.EndedExperienceImageRenewal(refresh);
    final request = _credentials.beginRequest(transport: transport);
    if (request == null) return core.EndedExperienceImageRenewal(SessionExpiredOutcome());
    try {
      return await core.renewExperienceImage(
        credentials: _credentials,
        request: request,
        target: target,
      );
    } finally {
      request.dispose();
    }
  }

  /// Runs one job and returns its outcome; never throws.
  Future<Outcome> run(Job job) async {
    try {
      return await _execute(job);
    } catch (_) {
      return FailedOutcome(BackendException.internal);
    }
  }

  Future<Outcome> _execute(Job job) async {
    switch (job) {
      case SessionJobVariant(job: RestoreSessionJob()):
        return _restore();
      case SessionJobVariant(job: CreateSessionJob()):
        return _establish(_sdk._transportFor(job));
      default:
        final transport = _sdk._transportFor(job);
        final refresh = await _credentials.refreshIfNeeded(transport: transport, nowMs: _nowMs());
        if (refresh != null) return refresh;
        final request = _credentials.beginRequest(transport: transport);
        if (request == null) return SessionExpiredOutcome();
        try {
          if (job case PhotoJobVariant(job: ProcessPhotoJob(:final photo))) {
            return await _upload(request, photo, transport);
          }
          final result = await core.runExperienceJob(
            credentials: _credentials,
            request: request,
            job: job,
            session: _session,
          );
          return result.outcome;
        } finally {
          request.dispose();
        }
    }
  }

  /// A native app keeps no cookie jar, so it always takes a bearer session.
  Future<Outcome> _establish(HttpTransport transport) async {
    final epoch = _credentials.beginEstablishment();
    final client = _sdk.api.withTransport(transport: transport);
    try {
      final created = await client.createBearerSession(
        body: CreateBearerSessionBody(dataProcessingConsent: true),
      );
      if (created.token.isEmpty) return UnknownOutcome();
      final installed = _credentials.install(
        epoch: epoch,
        credential: core.BearerExperienceCredential(
          expiresAt: created.expiresAt,
          token: created.token,
        ),
        cookieGeneration: _CredentialHost.noCookies,
      );
      return installed ? SessionOutcomeVariant(ReadySessionOutcome()) : UnknownOutcome();
    } on ApiException catch (error) {
      return core.classifyExperienceApiError(error: error, writes: true);
    } finally {
      client.dispose();
    }
  }

  Future<Outcome> _upload(
    core.ExperienceRequestCredential request,
    Photo photo,
    HttpTransport transport,
  ) async {
    final PreparedPhoto? image;
    try {
      image = await _photo(photo.media);
    } catch (_) {
      // The photo could not be read or decoded: choose another.
      return FailedOutcome(BackendException.invalidRequest);
    }
    if (image == null) return FailedOutcome(BackendException.invalidRequest);
    final client = request.client();
    try {
      return await core.uploadExperiencePhoto(
        client: client,
        host: _UploadHost(_credentials, request, image.bytes, transport),
        mimeType: image.mimeType,
        byteSize: image.bytes.length,
        imageMetadata: image.metadata,
      );
    } finally {
      client.dispose();
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _credentials.dispose();
  }
}

/// The original photo with the metadata the core reads from it, uploaded as is.
PreparedPhoto originalPhoto(Uint8List bytes, String mimeType) {
  final original = core.readImageMetadata(image: bytes);
  return PreparedPhoto(
    bytes,
    mimeType: mimeType,
    metadata: original == null
        ? null
        : core.PhotoUploadMetadata(original: original, uploaded: null),
  );
}

final class _CredentialHost implements core.ExperienceCredentialHost {
  _CredentialHost(this._refreshed);
  final void Function(int revision) _refreshed;

  /// Bearer sessions only: the cookie generation never changes.
  static const noCookies = 'native';

  @override
  String cookieGeneration() => noCookies;

  @override
  double parseExpiryMs(String value) =>
      DateTime.tryParse(value)?.millisecondsSinceEpoch.toDouble() ?? 0;

  @override
  double nowMs() => _nowMs();

  @override
  void credentialRefreshed(int revision) {
    // Called from inside the core: tell the state machine after it returns.
    scheduleMicrotask(() => _refreshed(revision));
  }
}

/// Whether a restore still matters: false once the experience is disposed.
final class _Current implements core.SessionEstablishmentHost {
  _Current(this._current);
  final bool Function() _current;
  @override
  bool isCurrent() => _current();
}

/// Moves the photo's bytes to the signed upload URL through the transport.
final class _UploadHost implements core.PhotoUploadHost {
  _UploadHost(this._credentials, this._request, this._bytes, this._transport);
  final core.ExperienceCredentials _credentials;
  final core.ExperienceRequestCredential _request;
  final Uint8List _bytes;
  final HttpTransport _transport;

  @override
  int? credentialRevision() =>
      _credentials.requestIsCurrent(request: _request) ? _request.revision() : null;

  @override
  Future<bool> transfer(PrepareBodyUploadResponse upload) async {
    try {
      final response = await _transport.send(
        HttpRequest(
          method: upload.method,
          url: upload.uploadUrl,
          headers: [
            for (final h in upload.requiredHeaders) HttpHeader(name: h.name, value: h.value),
          ],
          body: _bytes,
          withCredentials: false,
        ),
      );
      return response.status >= 200 && response.status < 300;
    } catch (_) {
      return false;
    }
  }
}

double _nowMs() => DateTime.now().millisecondsSinceEpoch.toDouble();
