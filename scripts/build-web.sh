#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --release --target wasm32-unknown-unknown -p osiris-app
wasm-bindgen --target web --no-typescript --out-dir web/pkg --out-name osiris \
  target/wasm32-unknown-unknown/release/osiris.wasm
ls -l web/pkg
