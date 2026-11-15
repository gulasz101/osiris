#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
bash scripts/build-web.sh
cd web/tests && npm install --silent 2>&1 | tail -5
timeout 120 node smoke.mjs
