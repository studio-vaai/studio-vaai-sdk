// Bundles the studio vaai SDK core (`sdks/core-rs`, the Rust library the
// generated bindings call) as this package's native asset
// `package:studio_vaai/uniffi:studio_vaai_core`.
//
// By default the hook compiles the core with cargo for the app's target, from
// the `core-rs` folder beside this package. An app can bundle a library it
// built itself instead, through a user-define in its pubspec.yaml:
//
//     hooks:
//       user_defines:
//         studio_vaai:
//           core_library: path/to/libstudio_vaai_core.dylib  # skips cargo
//           cargo_profile: debug                              # default: release
import 'dart:io';

import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';

const _assetName = 'uniffi:studio_vaai_core';
const _crate = 'studio-vaai-core';

void main(List<String> args) async {
  await build(args, (input, output) async {
    if (!input.config.buildCodeAssets) return;
    final code = input.config.code;
    final prebuilt = input.userDefines.path('core_library');
    final library = prebuilt ?? await _cargoBuild(input, code, output);
    if (!File.fromUri(library).existsSync()) {
      throw HookException('The studio vaai core library is missing: ${library.toFilePath()}');
    }
    // A prebuilt library is an input; one cargo just wrote is an output, and
    // naming it as an input makes the build report it modified and run again.
    if (prebuilt != null) output.dependencies.add(library);
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

final class HookException implements Exception {
  HookException(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<Uri> _cargoBuild(BuildInput input, CodeConfig code, BuildOutputBuilder output) async {
  final core = input.packageRoot.resolve('../core-rs/');
  if (!File.fromUri(core.resolve('Cargo.toml')).existsSync()) {
    throw HookException(
      'No core sources at ${core.toFilePath()}: set the studio_vaai user-define '
      '`core_library` to a prebuilt library for this target.',
    );
  }
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
    throw HookException(
      'cargo build of the studio vaai core for $triple failed:\n${result.stderr}',
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
      byArch[arch] ?? (throw HookException('The studio vaai core does not build for $os $arch.'));
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
  throw HookException('The studio vaai core does not build for $os.');
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
    throw HookException(
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
