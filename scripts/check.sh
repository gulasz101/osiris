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

echo "== no-direct-fs"
scripts/no-direct-fs.sh

echo "== check-site self-test"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# A game file in the site folder must be caught.
mkdir -p "$tmp/bad/Data"
: > "$tmp/bad/index.html"
: > "$tmp/bad/Data/test.sg3"
if scripts/check-site.sh "$tmp/bad" > "$tmp/bad.txt" 2>&1; then
  echo "check-site.sh passed a folder holding a game file"
  exit 1
fi
grep -q "test.sg3" "$tmp/bad.txt" || { echo "check-site.sh did not name the game file"; exit 1; }
grep -q "check-site: FAILED" "$tmp/bad.txt" || { echo "check-site.sh did not print FAILED"; exit 1; }
# The page files alone are fine.
mkdir -p "$tmp/good"
: > "$tmp/good/index.html"
: > "$tmp/good/.nojekyll"
scripts/check-site.sh "$tmp/good" | grep -q "check-site: OK" || {
  echo "check-site.sh rejected a clean site folder"
  exit 1
}
rm -rf "$tmp"


echo "== cargo test"
cargo test --workspace --quiet

echo "== wasm check"
cargo check --target wasm32-unknown-unknown -p osiris-app

echo "== openspec validate"
scripts/openspec validate --all --strict

echo "CHECK OK"
