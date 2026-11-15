#!/bin/sh
# Ensure no game files are tracked in the repository.
# Game data (sg3, pak, map, etc.) must never enter git; the browser reads them from disk.
# Usage: scripts/no-game-files.sh
# Exits 1 and prints offending paths when found; prints "no-game-files: OK" otherwise.
cd "$(dirname "$0")/.." || exit 1

found=$(git ls-files | grep -iE '\.(sg2|sg3|555|map|sav|pak|bik|smk|wav|mp3|eng|cmp)$|^(pharaoh_text|pharaoh_mm)' || true)
if [ -n "$found" ]; then
  printf "%s\n" "$found"
  echo "no-game-files: $(printf "%s\n" "$found" | wc -l | tr -d ' ') game file(s) tracked (remove them from git)" >&2
  exit 1
fi
echo "no-game-files: OK"
