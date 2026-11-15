# Tasks: web-start

- [ ] 1.1 Move the tail of `resumed` into `finish_start` (desktop only, no browser code yet). Check: `cargo test -p osiris-app` passes; the diff only moves code.
- [ ] 1.2 Add `mount_file` and `start_game` in `src/web.rs`. Check: wasm check exits 0.
- [ ] 1.3 Browser event loop with `spawn_app`, the canvas window, and the async graphics start with `pending` (design.md). Check: wasm check and `cargo check -p osiris-app` exit 0.
- [ ] 1.4 wgpu `webgl` feature for wasm. Check: `scripts/build-web.sh` succeeds.
- [ ] 1.5 `main.js` reads the chosen folder and calls `start_game`. Check: `scripts/web-smoke.sh` (no `OSIRIS_DATA`) still passes.
- [ ] 1.6 Smoke test with game data. Check: `OSIRIS_DATA=<folder from the issue> scripts/web-smoke.sh` prints `osiris web: main menu` and writes `/tmp/osiris-web-menu.png`. If no game data is on the host, leave this box open, say so in the comment, and set the issue `blocked`.
- [ ] 1.7 `scripts/check.sh` ends with `CHECK OK`.
