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
