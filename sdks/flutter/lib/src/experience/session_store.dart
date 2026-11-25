import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../generated/state_machine.dart' show PhotoSource;

/// What a shopper's try-on session leaves on the device between launches,
/// as the web keeps its session cookie and the committed body selection:
/// the bearer credential with its session's expiry, and the body last
/// committed (its ID and photo source, which the core needs to restore it).
@immutable
final class StoredTryOnSession {
  const StoredTryOnSession({
    required this.token,
    required this.expiresAtMs,
    this.bodyId,
    this.bodySource,
  });

  final String token;

  /// When the API expires the session, in milliseconds since the epoch.
  final double expiresAtMs;
  final String? bodyId;
  final PhotoSource? bodySource;

  bool expiredAt(DateTime now) => now.millisecondsSinceEpoch >= expiresAtMs;

  StoredTryOnSession withCredential(String token, double expiresAtMs) => StoredTryOnSession(
    token: token,
    expiresAtMs: expiresAtMs,
    bodyId: bodyId,
    bodySource: bodySource,
  );

  StoredTryOnSession withBody(String? id, PhotoSource? source) => StoredTryOnSession(
    token: token,
    expiresAtMs: expiresAtMs,
    bodyId: id,
    bodySource: id == null ? null : source,
  );

  String encode() => jsonEncode({
    'version': 1,
    'token': token,
    'expiresAtMs': expiresAtMs,
    if (bodyId != null) 'body': {'id': bodyId, 'source': bodySource?.name},
  });

  /// Stored data can outlive a version of the SDK or be malformed: `null`.
  static StoredTryOnSession? decode(String? raw) {
    if (raw == null) return null;
    try {
      final value = jsonDecode(raw);
      if (value is! Map || value['version'] != 1) return null;
      final token = value['token'], expires = value['expiresAtMs'];
      if (token is! String || token.isEmpty || expires is! num) return null;
      final body = value['body'];
      final id = body is Map ? body['id'] : null;
      final source = body is Map
          ? PhotoSource.values.where((s) => s.name == body['source']).firstOrNull
          : null;
      return StoredTryOnSession(
        token: token,
        expiresAtMs: expires.toDouble(),
        bodyId: id is String && source != null ? id : null,
        bodySource: id is String ? source : null,
      );
    } catch (_) {
      return null;
    }
  }
}

/// Where a [StoredTryOnSession] lives. [SecureTryOnSessionStore] by default;
/// pass `null` as a `StudioVaaiTryOn`'s `sessionStore` to keep nothing
/// between launches.
abstract interface class TryOnSessionStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// The platform's secure storage (`flutter_secure_storage`): the Keychain on
/// iOS and macOS, Keystore-encrypted storage on Android. The session is a
/// bearer secret, so it never goes to plain preferences.
final class SecureTryOnSessionStore implements TryOnSessionStore {
  SecureTryOnSessionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  // Storage that is unavailable (no Keychain access, a locked device) keeps
  // nothing: the shopper starts a new session, as the web without storage.
  @override
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String key, String value) async {
    try {
      await _storage.write(key: key, value: value);
    } catch (_) {}
  }

  @override
  Future<void> delete(String key) async {
    try {
      await _storage.delete(key: key);
    } catch (_) {}
  }
}

/// In memory only: for tests, and to share a session within one launch.
final class MemoryTryOnSessionStore implements TryOnSessionStore {
  final values = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// One shop's sessions: the key the web derives for its stored selection,
/// from the API's base URL and the shop's client key.
String tryOnSessionKey(String baseUrl, String clientApiKey) {
  final digest = sha256.convert(
    utf8.encode(jsonEncode([baseUrl.replaceAll(RegExp(r'/+$'), ''), clientApiKey])),
  );
  return 'sv.tryOn.session.$digest';
}

/// A try-on the shopper made with the kept body: only the opaque IDs needed
/// to ask the API for it again, never an image or a link.
@immutable
final class RememberedTryOn {
  const RememberedTryOn({
    required this.tryOnId,
    required this.productId,
    required this.variantId,
    required this.backendRevision,
  });

  final String tryOnId;
  final String productId;
  final String variantId;

  /// The backend's revision of the body the try-on read.
  final String backendRevision;

  Map<String, String> toJson() => {
    'tryOnId': tryOnId,
    'productId': productId,
    'variantId': variantId,
    'backendRevision': backendRevision,
  };

  static RememberedTryOn? fromJson(Object? value) {
    if (value is! Map) return null;
    final (id, product, variant, revision) = (
      value['tryOnId'],
      value['productId'],
      value['variantId'],
      value['backendRevision'],
    );
    if (id is! String || product is! String || variant is! String || revision is! String) {
      return null;
    }
    return RememberedTryOn(
      tryOnId: id,
      productId: product,
      variantId: variant,
      backendRevision: revision,
    );
  }
}

typedef _History = ({String bodyId, List<RememberedTryOn> tryOns});

/// The try-ons of the shopper's kept body, so a launch that restores the
/// session shows them again: the API lists bodies, but no try-ons. The web
/// SDK's `try-on-history`: one entry per API and shop, for one body (a new
/// body replaces the list), at most [limit] try-ons, oldest first. It lives
/// in the same store as the kept session and is cleared with it.
final class TryOnHistory {
  TryOnHistory(this._store, this._key);

  /// The most try-ons kept: the domain keeps no more results than this either.
  static const limit = 24;

  final TryOnSessionStore _store;
  final String _key;
  _History? _cache;
  bool _loaded = false;
  Future<void> _writes = Future.value();

  Future<_History?> _read() async {
    if (_loaded) return _cache;
    final raw = await _store.read(_key);
    if (!_loaded) {
      _loaded = true;
      _cache = _decode(raw);
    }
    return _cache;
  }

  static _History? _decode(String? raw) {
    if (raw == null) return null;
    try {
      final value = jsonDecode(raw);
      if (value is! Map || value['version'] != 1) return null;
      final bodyId = value['bodyId'], tryOns = value['tryOns'];
      if (bodyId is! String || tryOns is! List) return null;
      return (bodyId: bodyId, tryOns: [...tryOns.map(RememberedTryOn.fromJson).nonNulls]);
    } catch (_) {
      // Unreadable history is no history.
      return null;
    }
  }

  /// Writes in order, never failing the caller: without storage a launch
  /// starts without earlier try-ons.
  Future<void> _write(_History? history) {
    _cache = history;
    _loaded = true;
    final encoded = history == null
        ? null
        : jsonEncode({
            'version': 1,
            'bodyId': history.bodyId,
            'tryOns': [for (final t in history.tryOns) t.toJson()],
          });
    return _writes = _writes.then((_) async {
      try {
        if (encoded == null) {
          await _store.delete(_key);
        } else {
          await _store.write(_key, encoded);
        }
      } catch (_) {}
    });
  }

  /// Keeps a try-on of [bodyId], forgetting those of any other body.
  Future<void> remember(String bodyId, RememberedTryOn tryOn) async {
    // The cache as it is after the read: another write in the same turn may
    // have changed it while this one waited.
    await _read();
    final current = _cache;
    final kept = current?.bodyId == bodyId ? current!.tryOns : const <RememberedTryOn>[];
    final tryOns = [...kept.where((t) => t.tryOnId != tryOn.tryOnId), tryOn];
    await _write((
      bodyId: bodyId,
      tryOns: tryOns.sublist(tryOns.length > limit ? tryOns.length - limit : 0),
    ));
  }

  /// The try-ons kept for [bodyId], oldest first.
  Future<List<RememberedTryOn>> of(String bodyId) async {
    final current = await _read();
    return current?.bodyId == bodyId ? List.unmodifiable(current!.tryOns) : const [];
  }

  /// Forgets try-ons the API no longer has.
  Future<void> forget(Iterable<String> tryOnIds) async {
    final ids = tryOnIds.toSet();
    await _read();
    final current = _cache;
    if (current == null || ids.isEmpty) return;
    await _write((
      bodyId: current.bodyId,
      tryOns: [...current.tryOns.where((t) => !ids.contains(t.tryOnId))],
    ));
  }

  Future<void> clear() => _write(null);
}

/// One shop's try-on history: keyed like its session, by the API's base URL
/// and the shop's client key.
String tryOnHistoryKey(String baseUrl, String clientApiKey) {
  final digest = sha256.convert(
    utf8.encode(jsonEncode([baseUrl.replaceAll(RegExp(r'/+$'), ''), clientApiKey])),
  );
  return 'sv.tryOn.history.$digest';
}
