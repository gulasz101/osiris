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
# A movie run mounts the whole install before the intro starts, as a mission run does.
if [ -n "${SMOKE_MOVIE:-}" ]; then
    TIMEOUT=600
fi
# A remember run copies the whole install into the browser's storage and then reads it back.
if [ -n "${SMOKE_REMEMBER:-}" ]; then
    TIMEOUT=900
fi
# A viewport run reads the whole install through the page's picker and then runs a city.
if [ -n "${SMOKE_VIEWPORT:-}" ]; then
    TIMEOUT=900
fi
# A saves run starts a city from the menu, saves it, loads the save back and opens the panel.
if [ -n "${SMOKE_SAVES:-}" ]; then
    TIMEOUT=1200
fi
# A soak run plays 24 months of a city, then a custom map and the editor.
if [ -n "${SMOKE_SOAK:-}" ]; then
    TIMEOUT=1800
fi
# A trace run walks the menu to a city and records 20 s of it (web-frame-trace), so it gets
# the soak's timeout; the trace's own collection adds a little to the end.
if [ -n "${SMOKE_TRACE:-}" ]; then
    TIMEOUT=1800
fi
# A GPU run asks Chrome for the host's real GPU instead of the software-safe flags
# (web-gpu-fps); the soak timeout above covers it when it is a soak. SMOKE_HEADED is
# passed through by node's own environment, and only matters when headless gets no GPU.
if [ -n "${SMOKE_GPU:-}" ]; then
    TIMEOUT=1800
fi
timeout "$TIMEOUT" node smoke.mjs
