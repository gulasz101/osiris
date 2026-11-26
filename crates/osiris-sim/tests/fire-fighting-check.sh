#!/bin/sh
# The fire-fighting acceptance checks (change `sim-fire-fighting`).
#
#   sh crates/osiris-sim/tests/fire-fighting-check.sh AC-1
#   sh crates/osiris-sim/tests/fire-fighting-check.sh AC-2
#
# It runs the tests in `fire_fighting.rs` and prints the one line the factory reads,
# `AC-<n>: PASS` or `AC-<n>: FAIL <why>`, exiting 1 when the check failed. AC-1 is the
# near fire alone; AC-2 is the whole file, which also holds the far ruin and the two
# firemen. The tests build their own city, so no game data is needed.
set -u

ac=${1:-}
case "$ac" in
    AC-1 | AC-2) ;;
    *)
        echo "usage: $0 AC-1|AC-2" >&2
        exit 2
        ;;
esac

root=$(git rev-parse --show-toplevel)
if [ -z "$root" ]; then
    echo "$ac: FAIL not inside the checkout (git rev-parse --show-toplevel)" >&2
    exit 2
fi
cd "$root" || exit 2

log=$(mktemp)
if [ -z "$log" ]; then
    echo "$ac: FAIL no temporary file (mktemp)" >&2
    exit 2
fi
trap 'rm -f "$log"' EXIT INT TERM

filter=
if [ "$ac" = AC-1 ]; then
    filter=fireman_puts_out_a_burning_ruin_within_eight_days
fi

if [ -n "$filter" ]; then
    cargo test --quiet -p osiris-sim --test fire_fighting "$filter" -- --nocapture --test-threads=1 >"$log" 2>&1
    status=$?
else
    cargo test --quiet -p osiris-sim --test fire_fighting -- --nocapture --test-threads=1 >"$log" 2>&1
    status=$?
fi

line=$(grep -m1 "^$ac: FAIL " "$log")
if [ "$status" -ne 0 ] || [ -n "$line" ]; then
    if [ -z "$line" ]; then
        line="$ac: FAIL cargo test -p osiris-sim --test fire_fighting failed; run it for the output"
    fi
    echo "$line"
    exit 1
fi
echo "$ac: PASS"
exit 0
