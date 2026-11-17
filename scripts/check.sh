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
# A page script importing a script that is not in the folder must be caught.
mkdir -p "$tmp/imports"
: > "$tmp/imports/index.html"
printf 'import { gone } from "./gone.js";\n' > "$tmp/imports/a.js"
if scripts/check-site.sh "$tmp/imports" > "$tmp/imports.txt" 2>&1; then
  echo "check-site.sh passed a folder with a missing imported script"
  exit 1
fi
grep -q "check-site: missing gone.js (imported by a.js)" "$tmp/imports.txt" || {
  echo "check-site.sh did not name the missing imported script"
  exit 1
}
: > "$tmp/imports/gone.js"
scripts/check-site.sh "$tmp/imports" | grep -q "check-site: OK" || {
  echo "check-site.sh rejected a folder whose imports all resolve"
  exit 1
}
rm -rf "$tmp"


echo "== progress test"
node web/tests/progress-test.mjs

echo "== folder test"
node web/tests/folder-test.mjs

echo "== fit test"
node web/tests/fit-test.mjs

echo "== opfs test"
node web/tests/opfs-test.mjs

echo "== saves test"
node web/tests/saves-test.mjs

echo "== cargo test"
cargo test --workspace --quiet

echo "== wasm check"
cargo check --target wasm32-unknown-unknown -p osiris-app

echo "== openspec validate"
scripts/openspec validate --all --strict

echo "CHECK OK"
