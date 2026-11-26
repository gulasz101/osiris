#!/bin/sh
# The acceptance check for sim-trade-availability: trade is closed per mission as in
# the original, the Kingdom map still opens and says why, and Mennefer's 100-papyrus
# unlock is what opens it.
# Usage: sh crates/osiris-sim/tests/trade-availability-check.sh AC-1
set -u
cd "$(dirname "$0")/../../.." || { echo "AC-1: FAIL cannot reach the repository root"; exit 1; }

ac="${1:-}"
if [ "$ac" != "AC-1" ]; then
  echo "${ac:-AC-?}: FAIL unknown acceptance criterion (the only one is AC-1)"
  exit 1
fi

tmp=$(mktemp -d) || { echo "AC-1: FAIL no temporary folder for the test output"; exit 1; }
trap 'rm -rf "$tmp"' EXIT INT TERM

if cargo test -p osiris-sim --test trade_availability > "$tmp/out" 2>&1; then
  if grep -q "test result: ok. 5 passed" "$tmp/out"; then
    echo "AC-1: PASS"
    exit 0
  fi
  result=$(grep "test result:" "$tmp/out" | tail -n 1 | cut -c1-200)
  echo "AC-1: FAIL expected 'test result: ok. 5 passed', got '${result:-no test result line}'"
  exit 1
fi

reason=$(grep -m 1 "^error" "$tmp/out" | cut -c1-200)
[ -n "$reason" ] || reason=$(grep -m 1 "panicked at" "$tmp/out" | cut -c1-200)
[ -n "$reason" ] || reason=$(tail -n 1 "$tmp/out" | cut -c1-200)
echo "AC-1: FAIL cargo test failed: ${reason:-no output}"
exit 1
