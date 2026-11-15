#!/bin/sh
# Lists direct file system calls in non-test code of the crates the browser build uses.
# All file access there must go through osiris_vfs (see the web-vfs-* OpenSpec changes).
# Usage: scripts/no-direct-fs.sh [dir...]   (default: every crate the browser build uses)
# Exits 1 and prints file:line for every call left; prints "no-direct-fs: OK" when none.
cd "$(dirname "$0")/.." || exit 1
dirs="$*"
[ -n "$dirs" ] || dirs="crates/osiris-app/src crates/osiris-audio/src crates/osiris-bink/src crates/osiris-formats/src crates/osiris-render/src crates/osiris-sim/src crates/osiris-ui/src"
# shellcheck disable=SC2086
found=$(find $dirs -name '*.rs' ! -name 'test_support.rs' | sort | while read -r f; do
  awk -v f="$f" '
    /^[[:space:]]*#\[cfg\(test\)\][[:space:]]*$/ { pending = 1; next }
    pending && /^[[:space:]]*(pub(\([a-z]+\))? )?mod [A-Za-z_]+[[:space:]]*\{/ { exit }
    { pending = 0 }
    /^[[:space:]]*\/\// { next }
    /std::fs|[^a-z_:]fs::[a-z_]+\(|[^A-Za-z]File::(open|create)|\.is_dir\(\)|\.is_file\(\)|\.exists\(\)|\.metadata\(\)/ { print f ":" NR ": " $0 }
  ' "$f"
done)
if [ -n "$found" ]; then
  printf "%s\n" "$found"
  echo "no-direct-fs: $(printf "%s\n" "$found" | wc -l | tr -d ' ') direct file system calls left (use osiris_vfs)" >&2
  exit 1
fi
echo "no-direct-fs: OK"
