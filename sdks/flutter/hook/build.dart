// Bundles the studio vaai SDK core (`sdks/core-rs`, the Rust library the
// generated bindings call) as this package's native asset
// `package:studio_vaai/uniffi:studio_vaai_core`. The core comes from, in order:
//
// 1. the user-define `core_library`: a library the app built itself;
// 2. cargo, for the app's target, when the core's sources are beside this
//    package (`../core-rs`, in a checkout of the SDK repository);
// 3. otherwise, as when installed from pub.dev, the release's prebuilt library
//    for the target: downloaded once, checked against the SHA-256 that
//    `hook/prebuilt.json` pins, and cached (see `hook/src/prebuilt.dart`).
//
// User-defines, in the app's pubspec.yaml:
//
//     hooks:
//       user_defines:
//         studio_vaai:
//           core_library: path/to/libstudio_vaai_core.dylib  # no cargo, no download
//           cargo_profile: debug                              # default: release
//           prebuilt: true                                    # download beside the sources too
//           prebuilt_base_url: https://mirror.example/studio_vaai/
//
// `prebuilt_base_url` replaces the release's download URL, for a mirror or a
// test: an http(s) or file URL, or a folder relative to that pubspec. The
// checksums still come from `hook/prebuilt.json`. (Hooks see only a few
// environment variables, so this is a user-define, not one.)
import 'dart:io';

import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';

import 'src/prebuilt.dart';

const _assetName = 'uniffi:studio_vaai_core';
const _crate = 'studio-vaai-core';

void main(List<String> args) async {
  await build(args, (input, output) async {
    if (!input.config.buildCodeAssets) return;
    final code = input.config.code;
    final own = input.userDefines.path('core_library');
    final Uri library;
    if (own != null) {
      library = own;
    } else if (_coreSources(input) case final core? when input.userDefines['prebuilt'] != true) {
      library = await _cargoBuild(input, core, code, output);
    } else {
      library = await _download(input, code, output);
    }
    if (!File.fromUri(library).existsSync()) {
      throw BuildError(message: 'The studio vaai core library is missing: ${library.toFilePath()}');
    }
    // The app's own library is an input. One cargo just wrote, or a download,
    // is an output: naming it as an input makes the build report it modified
    // and run again.
    if (own != null) output.dependencies.add(library);
    output.assets.code.add(
      CodeAsset(
        package: input.packageName,
        name: _assetName,
        linkMode: DynamicLoadingBundled(),
        file: library,
      ),
    );
  });
}

/// The core's sources beside this package, in a checkout of the SDK repository.
Uri? _coreSources(BuildInput input) {
  final core = input.packageRoot.resolve('../core-rs/');
  final sources = File.fromUri(core.resolve('sdk-core/Cargo.toml')).existsSync();
  return sources ? core : null;
}

Future<Uri> _download(BuildInput input, CodeConfig code, BuildOutputBuilder output) async {
  final manifestFile = File.fromUri(input.packageRoot.resolve('hook/prebuilt.json'));
  if (!manifestFile.existsSync()) {
    throw BuildError(
      message:
          'This copy of studio_vaai has neither the core\'s sources (../core-rs) nor a prebuilt '
          'manifest (hook/prebuilt.json), which only released packages carry. Install studio_vaai '
          'from pub.dev, build it in a checkout of the SDK repository, or set the studio_vaai '
          'user-define `core_library` to a core you built.',
    );
  }
  output.dependencies.add(manifestFile.uri);
  final baseUrl = switch (input.userDefines['prebuilt_base_url']) {
    null => null,
    final String url when RegExp(r'^(https?|file)://').hasMatch(url) => Uri.parse(url),
    String() => input.userDefines.path('prebuilt_base_url'),
    final other => throw BuildError(
      message:
          'The studio_vaai user-define `prebuilt_base_url` must be a URL or a folder, not $other.',
    ),
  };
  try {
    final file = await fetchPrebuilt(
      manifest: PrebuiltManifest.read(manifestFile),
      target: _rustTarget(code),
      fileName: code.targetOS.dylibFileName('studio_vaai_core'),
      cache: Directory.fromUri(input.outputDirectoryShared.resolve('prebuilt/')),
      baseUrl: baseUrl,
    );
    return file.uri;
  } on PrebuiltException catch (e) {
    // A network failure is the infrastructure's, not the build's.
    throw e.network ? InfraError(message: e.message) : BuildError(message: e.message);
  }
}

Future<Uri> _cargoBuild(
  BuildInput input,
  Uri core,
  CodeConfig code,
  BuildOutputBuilder output,
) async {
  final triple = _rustTarget(code);
  final profile = (input.userDefines['cargo_profile'] as String?) ?? 'release';
  final environment = <String, String>{
    ..._appleDeploymentTarget(code),
    ..._androidLinker(code, triple),
  };
  final result = await Process.run(
    'cargo',
    [
      'build',
      '--quiet',
      '--locked',
      '--lib',
      '--package',
      _crate,
      '--target',
      triple,
      '--profile',
      profile == 'debug' ? 'dev' : profile,
    ],
    workingDirectory: core.toFilePath(),
    environment: environment,
  );
  if (result.exitCode != 0) {
    throw BuildError(
      message: 'cargo build of the studio vaai core for $triple failed:\n${result.stderr}',
    );
  }
  // Rerun when the core's sources change; cargo itself skips what is current.
  for (final path in [
    'Cargo.toml',
    'Cargo.lock',
    'sdk-core/',
    'api/',
    'state-machine/',
    'formatting/',
    'image-metadata/',
  ]) {
    output.dependencies.add(core.resolve(path));
  }
  final fileName = code.targetOS.dylibFileName('studio_vaai_core');
  return core.resolve('target/$triple/$profile/$fileName');
}

String _rustTarget(CodeConfig code) {
  final arch = code.targetArchitecture;
  final os = code.targetOS;
  String pick(Map<Architecture, String> byArch) =>
      byArch[arch] ??
      (throw BuildError(message: 'The studio vaai core does not build for $os $arch.'));
  if (os == OS.macOS) {
    return pick({
      Architecture.arm64: 'aarch64-apple-darwin',
      Architecture.x64: 'x86_64-apple-darwin',
    });
  }
  if (os == OS.iOS) {
    final simulator = code.iOS.targetSdk == IOSSdk.iPhoneSimulator;
    return pick({
      Architecture.arm64: simulator ? 'aarch64-apple-ios-sim' : 'aarch64-apple-ios',
      if (simulator) Architecture.x64: 'x86_64-apple-ios',
    });
  }
  if (os == OS.android) {
    return pick({
      Architecture.arm64: 'aarch64-linux-android',
      Architecture.arm: 'armv7-linux-androideabi',
      Architecture.x64: 'x86_64-linux-android',
    });
  }
  if (os == OS.linux) {
    return pick({
      Architecture.arm64: 'aarch64-unknown-linux-gnu',
      Architecture.x64: 'x86_64-unknown-linux-gnu',
    });
  }
  if (os == OS.windows) {
    return pick({Architecture.x64: 'x86_64-pc-windows-msvc'});
  }
  throw BuildError(message: 'The studio vaai core does not build for $os.');
}

Map<String, String> _appleDeploymentTarget(CodeConfig code) {
  if (code.targetOS == OS.macOS) {
    final v = code.macOS.deploymentVersion;
    return {'MACOSX_DEPLOYMENT_TARGET': '${v.major}.${v.minor}'};
  }
  if (code.targetOS == OS.iOS) {
    final v = code.iOS.deploymentVersion;
    return {'IPHONEOS_DEPLOYMENT_TARGET': '${v.major}.${v.minor}'};
  }
  return const {};
}

// Android links with the NDK's clang, which the Flutter tool passes as the C
// compiler; clang needs the target and API level.
Map<String, String> _androidLinker(CodeConfig code, String triple) {
  if (code.targetOS != OS.android) return const {};
  final clang = code.cCompiler?.compiler;
  if (clang == null) {
    throw BuildError(
      message:
          'Building the studio vaai core for Android needs the NDK (no C compiler was configured).',
    );
  }
  final clangTarget = triple == 'armv7-linux-androideabi' ? 'armv7a-linux-androideabi' : triple;
  final variable = triple.toUpperCase().replaceAll('-', '_');
  return {
    'CARGO_TARGET_${variable}_LINKER': clang.toFilePath(),
    'CARGO_TARGET_${variable}_RUSTFLAGS':
        '-C link-arg=--target=$clangTarget${code.android.targetNdkApi}',
  };
}
