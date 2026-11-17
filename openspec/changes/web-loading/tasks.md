# web-loading: tasks

## 1. The game names its steps
- [x] 1.1 `web::stage`, `web::stage_painted` and `web::notify_failed`; async `start_game`; `run()`
      split into `run_args`, `open_library`, `load_assets`, `run_loaded`.
      `cargo check --target wasm32-unknown-unknown -p osiris-app`.

## 2. The page
- [x] 2.1 `web/boot.js` with `web/tests/boot-test.mjs`, wired into `scripts/check.sh`.
- [x] 2.2 Boot line and bar on the title screen; the wasm download counted (`osiris_size.json`).
- [x] 2.3 Loading screen with steps, ticks, step times and a bar that moves off the main thread.

## 3. Checks
- [x] 3.1 `scripts/check.sh` ends with `CHECK OK`.
- [x] 3.2 `OSIRIS_DATA=<folder> SMOKE_PICK=1 scripts/web-smoke.sh` prints `loading steps OK`.
