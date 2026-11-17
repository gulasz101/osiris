#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bash scripts/build-web.sh
cd web/tests && npm install --silent 2>&1 | tail -5

# Use a longer timeout when game data is present (large folder), and the longest one for
# the mission runs: a city needs a while to turn two months.
TIMEOUT=${SMOKE_TIMEOUT:-120}
if [ -n "${OSIRIS_DATA:-}" ]; then
    TIMEOUT=360
fi
if [ -n "${SMOKE_MISSION:-}" ]; then
    TIMEOUT=600
fi
timeout "$TIMEOUT" node smoke.mjs
