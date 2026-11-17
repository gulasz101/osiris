#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# The browser build is a release build: a debug wasm is many times the size and the game
# is slow enough that the difference shows. `scripts/web-smoke.sh` runs this script too.
cargo build --release --target wasm32-unknown-unknown -p osiris-app
wasm-bindgen --target web --no-typescript --out-dir web/pkg --out-name osiris \
  target/wasm32-unknown-unknown/release/osiris.wasm

# wasm-opt (binaryen) strips and shrinks the wasm further, typically by a tenth. It is not
# installed here by default, so it is used when it is on PATH and skipped with one line
# when it is not: no new hard dependency.
if command -v wasm-opt >/dev/null 2>&1; then
  before=$(wc -c < web/pkg/osiris_bg.wasm)
  wasm-opt -O2 web/pkg/osiris_bg.wasm -o web/pkg/osiris_bg.wasm
  after=$(wc -c < web/pkg/osiris_bg.wasm)
  echo "osiris web: wasm-opt -O2 shrank the wasm from $before to $after bytes"
else
  echo "osiris web: no wasm-opt on PATH, keeping the release build as wasm-bindgen left it"
fi

# The page's boot bar needs the wasm's real size: a server that sends it gzipped (GitHub
# Pages does) puts only the compressed size in Content-Length (web/boot.js, wasmSize).
printf '{ "bytes": %s }\n' "$(wc -c < web/pkg/osiris_bg.wasm | tr -d ' ')" > web/pkg/osiris_size.json

ls -l web/pkg
