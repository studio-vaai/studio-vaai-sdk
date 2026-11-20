// Writes hook/prebuilt.json, the manifest the build hook downloads the core
// by: each release library's file name, size and SHA-256, and the release's
// download URL. The release workflow runs it on the libraries it built, before
// it packs the package, so the published package pins exactly those bytes.
//
//     dart tool/prebuilt_manifest.dart --artifacts DIR --base-url URL \
//         [--version VERSION] [--output hook/prebuilt.json] [--partial]
//
// DIR holds libstudio_vaai_core-TARGET.{so,dylib}, as tool/build_core.sh
// names them. Every target Flutter builds for must be there, unless --partial.
// VERSION defaults to the pubspec's.
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

import '../hook/src/prebuilt.dart';

/// What Flutter builds for on Android, iOS and macOS.
const targets = [
  'aarch64-linux-android',
  'armv7-linux-androideabi',
  'x86_64-linux-android',
  'aarch64-apple-ios',
  'aarch64-apple-ios-sim',
  'x86_64-apple-ios',
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
];

final _artifact = RegExp(r'^libstudio_vaai_core-(.+)\.(so|dylib)$');

Future<void> main(List<String> arguments) async {
  final options = <String, String>{};
  var partial = false;
  for (var i = 0; i < arguments.length; i++) {
    final argument = arguments[i];
    if (argument == '--partial') {
      partial = true;
    } else if (argument.startsWith('--') && i + 1 < arguments.length) {
      options[argument.substring(2)] = arguments[++i];
    } else {
      _fail('Unexpected argument $argument.');
    }
  }
  final artifacts = Directory(options['artifacts'] ?? _fail('--artifacts DIR is required.'));
  final baseUrl = Uri.parse(options['base-url'] ?? _fail('--base-url URL is required.'));
  final version = options['version'] ?? _pubspecVersion();
  final output = File(options['output'] ?? 'hook/prebuilt.json');

  final libraries = <String, PrebuiltLibrary>{};
  for (final file in artifacts.listSync().whereType<File>()) {
    final name = file.uri.pathSegments.last;
    final match = _artifact.firstMatch(name);
    if (match == null) continue;
    final target = match[1]!;
    if (!targets.contains(target)) _fail('$name is for $target, which Flutter does not build for.');
    final bytes = file.readAsBytesSync();
    libraries[target] = PrebuiltLibrary(
      file: name,
      sha256: sha256.convert(bytes).toString(),
      size: bytes.length,
    );
  }
  final missing = targets.where((t) => !libraries.containsKey(t)).toList();
  if (libraries.isEmpty || (missing.isNotEmpty && !partial)) {
    _fail('No library in ${artifacts.path} for ${missing.join(', ')}.');
  }
  final manifest = PrebuiltManifest(version: version, baseUrl: baseUrl, libraries: libraries);
  output.writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(manifest.toJson())}\n');
  stdout.writeln(
    '${output.path}: ${libraries.length} libraries for $version from ${manifest.baseUrl}',
  );
}

String _pubspecVersion() {
  final pubspec = File.fromUri(Platform.script.resolve('../pubspec.yaml')).readAsStringSync();
  final match = RegExp(r'^version:\s*(\S+)\s*$', multiLine: true).firstMatch(pubspec);
  return match?[1] ?? _fail('No version in pubspec.yaml.');
}

Never _fail(String message) {
  stderr.writeln(message);
  exit(1);
}
