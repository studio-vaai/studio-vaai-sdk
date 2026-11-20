#!/usr/bin/env bash
# Builds the prebuilt studio vaai core that the build hook downloads, for one
# Rust target: the release profile (size-tuned, LTO, stripped), as a shared
# library only, into OUT_DIR/libstudio_vaai_core-TARGET.{so,dylib}.
#
# Usage: build_core.sh TARGET OUT_DIR
#
#   Android (aarch64-linux-android, armv7-linux-androideabi, x86_64-linux-android)
#     needs the NDK: ANDROID_NDK_HOME, or the newest ndk/ under ANDROID_HOME.
#     Links at API level 21 with 16 KB page alignment.
#   Apple (aarch64-apple-darwin, x86_64-apple-darwin, aarch64-apple-ios,
#     aarch64-apple-ios-sim, x86_64-apple-ios) needs macOS; iOS needs Xcode.
#     Deployment targets: macOS 10.15, iOS 13.0 (Flutter's minimums).
#
# The Rust toolchain and targets are the ones ../core-rs/rust-toolchain.toml pins.
set -euo pipefail

if (($# != 2)); then
  echo "usage: $0 TARGET OUT_DIR" >&2
  exit 2
fi
target=$1
mkdir -p "$2"
out=$(cd "$2" && pwd)
core=$(cd "$(dirname "$0")/../../core-rs" && pwd)
variable() { echo "$target" | tr '[:lower:]-' '[:upper:]_'; }

# Android's API level: the oldest Flutter and the Rust standard library support.
android_api=21

# Build paths stay out of the library's panic messages.
cargo_home=${CARGO_HOME:-$HOME/.cargo}
rustflags=(--remap-path-prefix="$cargo_home=/cargo" --remap-path-prefix="$core=/core-rs")

case $target in
  *-linux-android*)
    ndk=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
    if [[ -z $ndk && -n ${ANDROID_HOME:-} && -d $ANDROID_HOME/ndk ]]; then
      ndk=$(printf "%s\n" "$ANDROID_HOME"/ndk/* | sort -V | tail -1)
    fi
    if [[ -z $ndk || ! -d $ndk ]]; then
      echo "Building for $target needs the Android NDK: set ANDROID_NDK_HOME." >&2
      exit 1
    fi
    case $(uname -s) in
      Darwin) host=darwin-x86_64 ;; # also the folder of the arm64 NDK
      Linux) host=linux-x86_64 ;;
      *) echo "Unsupported build host $(uname -s)." >&2; exit 1 ;;
    esac
    clang_target=${target/armv7-/armv7a-}
    linker=$ndk/toolchains/llvm/prebuilt/$host/bin/$clang_target$android_api-clang
    [[ -x $linker ]] || { echo "No NDK clang at $linker." >&2; exit 1; }
    export "CARGO_TARGET_$(variable)_LINKER=$linker"
    # 16 KB pages: required on Android 15+ devices that use them, and by Play.
    rustflags+=(-C "link-arg=-Wl,-z,max-page-size=16384")
    extension=so
    ;;
  *-apple-darwin | *-apple-ios*)
    if [[ $target == *-apple-darwin ]]; then
      export MACOSX_DEPLOYMENT_TARGET=10.15
    else
      export IPHONEOS_DEPLOYMENT_TARGET=13.0
      # Without Xcode the linker falls back to the macOS SDK, silently.
      xcrun --sdk "$([[ $target == *-sim ]] && echo iphonesimulator || echo iphoneos)" --show-sdk-path >/dev/null
    fi
    # Bundlers rewrite it; it names no build folder meanwhile.
    rustflags+=(-C "link-arg=-Wl,-install_name,@rpath/libstudio_vaai_core.dylib")
    extension=dylib
    ;;
  *)
    echo "No prebuilt core for $target." >&2
    exit 1
    ;;
esac

# Joined with .cargo/config.toml's flags for the target, which RUSTFLAGS would replace.
export "CARGO_TARGET_$(variable)_RUSTFLAGS=${rustflags[*]}"

cd "$core"
# Only the shared library: the crate's staticlib is for the iOS xcframework.
cargo rustc --locked --release --lib -p studio-vaai-core --target "$target" --crate-type cdylib

target_dir=$(cargo metadata --no-deps --format-version 1 | python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])')
library=$target_dir/$target/release/libstudio_vaai_core.$extension
artifact=$out/libstudio_vaai_core-$target.$extension
cp "$library" "$artifact"
echo "$artifact"
