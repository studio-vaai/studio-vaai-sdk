// The build hook's download of the prebuilt core (hook/src/prebuilt.dart),
// against a local HTTP server.
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';

import '../hook/src/prebuilt.dart';

void main() {
  late Directory temp;
  late Directory cache;
  late HttpServer server;
  late int port;
  late Map<String, List<int>> served;
  late List<String> requests;
  final library = utf8.encode('a shared library');
  const target = 'aarch64-linux-android';

  PrebuiltManifest manifest({List<int>? bytes, String? sha256Hex}) => PrebuiltManifest(
    version: '0.1.0',
    baseUrl: Uri.parse('http://localhost:$port/release'),
    libraries: {
      target: PrebuiltLibrary(
        file: 'libstudio_vaai_core-$target.so',
        sha256: sha256Hex ?? sha256.convert(bytes ?? library).toString(),
        size: (bytes ?? library).length,
      ),
    },
  );

  Future<File> fetch(PrebuiltManifest manifest, {Uri? baseUrl, String target = target}) =>
      fetchPrebuilt(
        manifest: manifest,
        target: target,
        fileName: 'libstudio_vaai_core.so',
        cache: cache,
        baseUrl: baseUrl,
        retryDelay: Duration.zero,
      );

  setUp(() async {
    temp = Directory.systemTemp.createTempSync('studio_vaai_prebuilt_test');
    cache = Directory('${temp.path}/cache');
    served = {'/release/libstudio_vaai_core-$target.so': library};
    requests = [];
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    port = server.port;
    server.listen((request) async {
      requests.add(request.uri.path);
      final body = served[request.uri.path];
      if (request.uri.path == '/flaky' && requests.where((r) => r == '/flaky').length < 3) {
        request.response.statusCode = HttpStatus.serviceUnavailable;
      } else if (request.uri.path == '/flaky') {
        request.response.add(library);
      } else if (body == null) {
        request.response.statusCode = HttpStatus.notFound;
      } else {
        request.response.add(body);
      }
      await request.response.close();
    });
  });

  tearDown(() async {
    await server.close(force: true);
    temp.deleteSync(recursive: true);
  });

  test('downloads, verifies and names the library for the target', () async {
    final file = await fetch(manifest());
    expect(file.readAsBytesSync(), library);
    expect(file.path, endsWith('/libstudio_vaai_core.so'));
    expect(requests, ['/release/libstudio_vaai_core-$target.so']);
    expect(file.parent.listSync(), hasLength(1), reason: 'no partial download is left');
  });

  test('reuses the cached library offline', () async {
    final first = await fetch(manifest());
    await server.close(force: true);
    final second = await fetch(manifest());
    expect(second.path, first.path);
    expect(second.readAsBytesSync(), library);
  });

  test('downloads again when the cached file is damaged', () async {
    final file = await fetch(manifest());
    file.writeAsStringSync('damaged');
    expect((await fetch(manifest())).readAsBytesSync(), library);
    expect(requests, hasLength(2));
  });

  test('refuses a download that does not match the checksum, and caches nothing', () async {
    served['/release/libstudio_vaai_core-$target.so'] = utf8.encode('something else');
    await expectLater(
      fetch(manifest()),
      throwsA(
        isA<PrebuiltException>()
            .having((e) => e.network, 'network', isFalse)
            .having(
              (e) => e.message,
              'message',
              allOf(
                contains('does not match the checksum'),
                contains(sha256.convert(library).toString()),
              ),
            ),
      ),
    );
    expect(cache.listSync(recursive: true).whereType<File>(), isEmpty);
  });

  test('says which targets a release has', () async {
    await expectLater(
      fetch(manifest(), target: 'riscv64gc-unknown-linux-gnu'),
      throwsA(
        isA<PrebuiltException>().having(
          (e) => e.message,
          'message',
          allOf(
            contains('has no prebuilt core for riscv64gc-unknown-linux-gnu'),
            contains(target),
            contains('core_library'),
          ),
        ),
      ),
    );
    expect(requests, isEmpty);
  });

  test('explains a failed download when offline', () async {
    await server.close(force: true);
    await expectLater(
      fetch(manifest(), baseUrl: Uri.parse('http://localhost:$port/release/')),
      throwsA(
        isA<PrebuiltException>()
            .having((e) => e.network, 'network', isTrue)
            .having(
              (e) => e.message,
              'message',
              allOf(contains('Could not download'), contains('HTTPS_PROXY'), contains(cache.path)),
            ),
      ),
    );
  });

  test('does not retry a missing file', () async {
    await expectLater(
      fetch(manifest(), baseUrl: Uri.parse('http://localhost:${server.port}/elsewhere')),
      throwsA(isA<PrebuiltException>().having((e) => e.message, 'message', contains('HTTP 404'))),
    );
    expect(requests, ['/elsewhere/libstudio_vaai_core-$target.so']);
  });

  test('retries server errors', () async {
    final flaky = PrebuiltManifest(
      version: '0.1.0',
      baseUrl: Uri.parse('http://localhost:${server.port}/'),
      libraries: {
        target: PrebuiltLibrary(
          file: 'flaky',
          sha256: sha256.convert(library).toString(),
          size: library.length,
        ),
      },
    );
    expect((await fetch(flaky)).readAsBytesSync(), library);
    expect(requests, ['/flaky', '/flaky', '/flaky']);
  });

  test('reads a release folder through a file URL', () async {
    final folder = Directory('${temp.path}/release')..createSync();
    File('${folder.path}/libstudio_vaai_core-$target.so').writeAsBytesSync(library);
    final file = await fetch(manifest(), baseUrl: folder.uri);
    expect(file.readAsBytesSync(), library);
    expect(requests, isEmpty);
  });

  group('manifest', () {
    test('round-trips through JSON', () {
      final json = jsonDecode(jsonEncode(manifest().toJson()));
      final read = PrebuiltManifest.fromJson(json);
      expect(read.toJson(), manifest().toJson());
      expect(read.baseUrl.path, endsWith('/'));
    });

    test('rejects an entry without a checksum', () {
      expect(
        () => PrebuiltManifest.fromJson({
          'version': '1.0.0',
          'base_url': 'https://example.test/',
          'libraries': {
            target: {'file': 'x.so', 'size': 1},
          },
        }),
        throwsA(isA<PrebuiltException>()),
      );
    });

    test('rejects a file name with a path', () {
      expect(
        () => PrebuiltManifest.fromJson({
          'version': '1.0.0',
          'base_url': 'https://example.test/',
          'libraries': {
            target: {'file': '../x.so', 'sha256': '0' * 64, 'size': 1},
          },
        }),
        throwsA(isA<PrebuiltException>()),
      );
    });
  });
}
