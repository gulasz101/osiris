#!/bin/sh
# The gate for every change: branch, game files, tests, wasm build, openspec.
# Usage: scripts/check.sh
set -eu
cd "$(dirname "$0")/.." || exit 1

echo "== branch"
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "work on main only (AGENTS.md)"; exit 1; }

echo "== no-game-files"
scripts/no-game-files.sh

echo "== cargo test"
cargo test --workspace --quiet

echo "== wasm check"
cargo check --target wasm32-unknown-unknown -p osiris-app

echo "== openspec validate"
scripts/openspec validate --all --strict

echo "CHECK OK"
