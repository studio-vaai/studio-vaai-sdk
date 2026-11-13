#!/usr/bin/env bash
set -euo pipefail

# Run after generating bindings. UniFFI's generator reads these metadata exports.
# -O1 gives a smaller compressed asset than -Oz for this module.
exec wasm-opt "$1" -o "$2" \
  --enable-bulk-memory-opt \
  --enable-nontrapping-float-to-int \
  '--remove-exports=UNIFFI_META_*' \
  -O1
