# Tasks: web-soak

- [x] 1.1 The plan: this proposal, `design.md`, these tasks and the spec delta. Check: `scripts/openspec validate --all --strict` exits 0.
- [x] 1.2 `crates/osiris-app/src/soak.rs`: the frames-per-second window and the twelve-month growth run, with their test (design 1, 2). Check: `cargo test -p osiris-app soak` passes.
- [x] 1.3 The browser hooks in `web.rs` and `main.rs`: `set_soak`, `memory_bytes`, `debug_editor`, and the two log lines (design 3, 4). Check: `cargo check --target wasm32-unknown-unknown -p osiris-app` and `cargo test --workspace` pass.
- [x] 1.4 `menu.rs`: the scroll arrows and the go arrow as debug buttons (design 5). Check: `cargo check --target wasm32-unknown-unknown -p osiris-app` passes and, with game data, `debug_menu_buttons()` on the custom page lists `Scroll(1)` and `Choose(StartMap)`.
- [x] 1.5 `SMOKE_SOAK=1` mission run: mission 0 from the menu at the fastest speed, 24 months, the three failures and the `soak OK` line (design 6). Check: `OSIRIS_DATA=<folder> SMOKE_SOAK=1 scripts/web-smoke.sh` prints `osiris web: soak OK (24 months, min fps N, memory start A MB end B MB)`. Paste it in the issue comment.
- [x] 1.6 The custom map run: `Small Oasis.map` from Custom Missions, 6 months (design 7). Check: the same command prints `osiris web: custom map soak OK (6 months on Small Oasis, ...)`.
- [x] 1.7 The Mission Editor run: open `Small Oasis.map`, paint tiles, save as a new name in `/user/maps`, back to the menu (design 8). Check: the same command prints `osiris web: editor OK (Small Oasis edited and saved as ...)`.
- [x] 1.8 The numbers in `design.md`, the STATUS.md lines, the archive. Check: `scripts/check.sh` ends with `CHECK OK`.
