# web-compiles: osiris-app compiles for the browser, and one gate script checks everything

## Why
Before any browser work we need two things: the program must compile for
`wasm32-unknown-unknown`, and one script must tell an agent "all good" or "broken". A probe on
2026-11-15 showed that only two errors stand between `main` and a wasm build:
1. `getrandom` has no browser backend switched on.
2. `rfd::FileDialog` (the desktop folder picker in `crates/osiris-app/src/data_dir.rs`) does not
   exist on wasm.

## What changes
- `getrandom` 0.3 and 0.4 get their `wasm_js` backend for the wasm target only.
- The desktop folder picker is compiled only on desktop; on wasm `data_dir::pick` returns `None`.
- New `scripts/no-game-files.sh`: fails when a game file is tracked by git.
- New `scripts/check.sh`: the gate (branch is `main`, no game files, native tests, wasm compile,
  OpenSpec valid) ending with `CHECK OK`.

## Out of scope
The program will compile, not run, in a browser. Running is the job of the next changes
(`web-time-threads`, `web-vfs`, `web-page`).
