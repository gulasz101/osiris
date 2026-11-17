# web-gpu-fps: one fps number with a real GPU on the M1 Air

## Why
`web-perf` showed that our own work (sim, render, io) is about 8 ms of a ~180 ms frame in the
soak run. The rest (`other`) is headless Chrome drawing WebGL2 without a GPU:
`web/tests/smoke.mjs` launches Chromium with `--use-angle=gl`, which in headless mode on this
host ends in a software renderer. So the soak's `min fps` says nothing about a player's machine.
This change runs the same soak on the M1 Air's real GPU (ANGLE on Metal) and records the number.

## What changes
- `crates/osiris-app/src/gfx.rs` (`adapter`): on wasm, log one line
  `osiris web: gfx backend <WebGPU|WebGL2> adapter <name>` from `Adapter::get_info()`.
- `web/tests/smoke.mjs`: print that line in every run; with `SMOKE_GPU=1`, launch Chromium with
  the Metal flags (design 2), and FAIL when the adapter is a software one.
- `scripts/web-smoke.sh`: pass `SMOKE_GPU` (and `SMOKE_HEADED`) through to `smoke.mjs`.
- `docs/STATUS.md`: the GPU numbers next to the headless numbers.

## Out of scope
- Any speed fix. If the GPU min fps is under 20, STATUS.md names the biggest cost; the hourly
  check plans the fix as a new change.
- Switching the web build to the WebGPU backend (`Backends::BROWSER_WEBGPU`). The page stays on
  `Backends::GL`; the log line just says which backend it got.
- Any change to the game rules or to the default (headless) soak.
