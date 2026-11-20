// The prebuilt studio vaai core: the release's manifest
// (`lib/src/native/prebuilt.json`) and the download the build hook makes when
// the core's sources are not beside the package, as in an install from pub.dev.
//
// Each release publishes one shared library per Rust target. The manifest
// committed into the published package pins their file names, sizes and
// SHA-256, so a build only ever bundles the exact bytes that release built.
// Downloads are cached per checksum, so a target downloads once and later
// builds, also offline, reuse it.
//
// Only the build hook (`hook/build.dart`), the release tooling and the tests
// import this library: no public library of the package does, so apps never
// compile it. It lives here, not beside the hook, because pub.dev accepts no
// Dart file under `hook/` but the hook entry points themselves.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

/// Where the manifest is in the package, relative to its root: the release
/// workflow writes it there before it packs the package.
const prebuiltManifestPath = 'lib/src/native/prebuilt.json';

/// The prebuilt libraries of one release, by Rust target.
final class PrebuiltManifest {
  PrebuiltManifest({required this.version, required Uri baseUrl, required this.libraries})
    : baseUrl = directoryUri(baseUrl);

  /// Reads the manifest at [file], as the release workflow writes it.
  factory PrebuiltManifest.read(File file) {
    final Object? json;
    try {
      json = jsonDecode(file.readAsStringSync());
    } on FormatException catch (e) {
      throw PrebuiltException('${file.path} is not valid JSON: ${e.message}');
    }
    return PrebuiltManifest.fromJson(json, source: file.path);
  }

  factory PrebuiltManifest.fromJson(Object? json, {String source = 'The prebuilt manifest'}) {
    Never invalid(String what) => throw PrebuiltException('$source is invalid: $what.');
    if (json is! Map<String, Object?>) invalid('not a JSON object');
    final version = json['version'];
    final baseUrl = json['base_url'];
    final libraries = json['libraries'];
    if (version is! String || version.isEmpty) invalid('no "version"');
    if (baseUrl is! String || Uri.tryParse(baseUrl)?.hasScheme != true) invalid('no "base_url"');
    if (libraries is! Map<String, Object?>) invalid('no "libraries"');
    return PrebuiltManifest(
      version: version,
      baseUrl: Uri.parse(baseUrl),
      libraries: {
        for (final MapEntry(:key, :value) in libraries.entries)
          key: switch (value) {
            {'file': final String file, 'sha256': final String sha256, 'size': final int size}
                when _sha256.hasMatch(sha256) && !file.contains('/') =>
              PrebuiltLibrary(file: file, sha256: sha256, size: size),
            _ => invalid('the entry of $key needs "file", a lowercase hex "sha256" and "size"'),
          },
      },
    );
  }

  /// The package version these libraries were built for.
  final String version;

  /// Where the release's files are: its GitHub release's download URL.
  final Uri baseUrl;

  /// The libraries, by Rust target triple.
  final Map<String, PrebuiltLibrary> libraries;

  Map<String, Object?> toJson() => {
    'version': version,
    'base_url': baseUrl.toString(),
    'libraries': {
      for (final target in libraries.keys.toList()..sort()) target: libraries[target]!.toJson(),
    },
  };

  static final _sha256 = RegExp(r'^[0-9a-f]{64}$');
}

/// One target's library in a release.
final class PrebuiltLibrary {
  PrebuiltLibrary({required this.file, required this.sha256, required this.size});

  /// Its file name in the release.
  final String file;

  /// Its SHA-256, lowercase hex.
  final String sha256;

  /// Its size in bytes.
  final int size;

  Map<String, Object?> toJson() => {'file': file, 'sha256': sha256, 'size': size};
}

final class PrebuiltException implements Exception {
  PrebuiltException(this.message, {this.network = false});
  final String message;

  /// Whether the download failed, rather than what it found.
  final bool network;
  @override
  String toString() => message;
}

/// [uri] with a trailing slash, so that files resolve inside it.
Uri directoryUri(Uri uri) => uri.path.endsWith('/') ? uri : uri.replace(path: '${uri.path}/');

/// The verified library for [target], as [fileName] in [cache]: from the cache
/// when it holds it, otherwise downloaded from [baseUrl] (the manifest's own
/// by default; `http`, `https` or `file`).
///
/// Throws a [PrebuiltException] that says what to do when the release has no
/// library for [target], the download fails, or what arrives does not match
/// the manifest's checksum.
Future<File> fetchPrebuilt({
  required PrebuiltManifest manifest,
  required String target,
  required String fileName,
  required Directory cache,
  Uri? baseUrl,
  Duration retryDelay = const Duration(seconds: 1),
}) async {
  final library = manifest.libraries[target];
  if (library == null) {
    final targets = manifest.libraries.keys.toList()..sort();
    throw PrebuiltException(
      'studio_vaai ${manifest.version} has no prebuilt core for $target; it has one for '
      '${targets.join(', ')}. To build for $target, bundle a core you built yourself: set the '
      'studio_vaai user-define `core_library` to its path in your app\'s pubspec.yaml.',
    );
  }
  // Content-addressed: another release, or another mirror, never reuses it.
  final directory = Directory.fromUri(cache.uri.resolve('${library.sha256}/'));
  final file = File.fromUri(directory.uri.resolve(fileName));
  if (file.existsSync()) {
    if (await _sha256Of(file) == library.sha256) return file;
    file.deleteSync();
  }

  final url = directoryUri(baseUrl ?? manifest.baseUrl).resolve(library.file);
  final created = !directory.existsSync();
  directory.createSync(recursive: true);
  final partial = File('${file.path}.$pid.part');
  var done = false;
  try {
    await _download(url, partial, retryDelay: retryDelay, cache: cache);
    final size = partial.lengthSync();
    final sha256 = await _sha256Of(partial);
    if (sha256 != library.sha256 || size != library.size) {
      throw PrebuiltException(
        'The studio vaai core downloaded from $url does not match the checksum studio_vaai '
        '${manifest.version} pins for $target: expected SHA-256 ${library.sha256} '
        '(${library.size} bytes), got $sha256 ($size bytes). It was discarded. '
        '${baseUrl == null ? 'The release\'s files must not change after publication.' : 'The '
                  'user-define `prebuilt_base_url` ($baseUrl) serves other files than release '
                  '${manifest.version}.'}',
      );
    }
    partial.renameSync(file.path);
    done = true;
    return file;
  } finally {
    if (partial.existsSync()) partial.deleteSync();
    // A failed download leaves no empty checksum folder behind. Not recursive:
    // a folder another build has meanwhile put its download in stays.
    if (!done && created) {
      try {
        directory.deleteSync();
      } on FileSystemException {
        // Not empty, or gone.
      }
    }
  }
}

Future<String> _sha256Of(File file) async => (await sha256.bind(file.openRead()).single).toString();

Future<void> _download(
  Uri url,
  File into, {
  required Duration retryDelay,
  required Directory cache,
}) async {
  if (url.scheme == 'file') {
    final source = File.fromUri(url);
    if (!source.existsSync()) {
      throw PrebuiltException('The prebuilt studio vaai core is not at $url.');
    }
    source.copySync(into.path);
    return;
  }
  if (url.scheme != 'https' && url.scheme != 'http') {
    throw PrebuiltException('Cannot download the studio vaai core from $url: not http(s) or file.');
  }
  const attempts = 3;
  for (var attempt = 1; ; attempt++) {
    try {
      await _get(url, into);
      return;
    } on _RetryableError catch (e) {
      if (attempt == attempts) {
        throw PrebuiltException(
          'Could not download the studio vaai core from $url: ${e.reason}. The build hook '
          'downloads the core once per target and keeps it in ${cache.path}, so later builds '
          'work offline. Check the network connection (proxies come from HTTPS_PROXY, '
          'HTTP_PROXY and NO_PROXY), or set the studio_vaai user-define `prebuilt_base_url` to '
          'a mirror of the release\'s files.',
          network: true,
        );
      }
      await Future<void>.delayed(retryDelay * attempt);
    }
  }
}

Future<void> _get(Uri url, File into) async {
  final client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 30)
    ..idleTimeout = const Duration(seconds: 30)
    ..findProxy = HttpClient.findProxyFromEnvironment
    ..userAgent = 'studio_vaai build hook';
  try {
    final request = await client.getUrl(url);
    final response = await request.close().timeout(const Duration(seconds: 60));
    if (response.statusCode != HttpStatus.ok) {
      await response.drain<void>();
      final status = 'HTTP ${response.statusCode} ${response.reasonPhrase}';
      if (response.statusCode >= 500 || response.statusCode == HttpStatus.tooManyRequests) {
        throw _RetryableError(status);
      }
      throw PrebuiltException(
        'Could not download the studio vaai core from $url: $status. Its release, or the '
        'mirror that the user-define `prebuilt_base_url` names, does not serve it.',
      );
    }
    final sink = into.openWrite();
    try {
      await response.timeout(const Duration(seconds: 60)).pipe(sink);
    } finally {
      await sink.close();
    }
  } on SocketException catch (e) {
    throw _RetryableError(e.osError?.message ?? e.message);
  } on HttpException catch (e) {
    throw _RetryableError(e.message);
  } on TimeoutException {
    throw _RetryableError('timed out');
  } on HandshakeException catch (e) {
    throw _RetryableError('TLS handshake failed: ${e.message}');
  } finally {
    client.close(force: true);
  }
}

final class _RetryableError implements Exception {
  _RetryableError(this.reason);
  final String reason;
}
