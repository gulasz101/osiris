# Tasks: web-vfs-main

- [x] 1.1 `user_dir()` for the browser and the Windows-only log file (design.md). Check: `cargo check -p osiris-app` and the wasm check exit 0.
- [x] 1.2 Switch the calls in `main.rs` lines 1-420 (settings, families, progress, saves list). Check: `scripts/no-direct-fs.sh crates/osiris-app/src/main.rs` lists no line below 430; `cargo test -p osiris-app` passes.
- [x] 1.3 Switch the rest of `main.rs` (autosave, `write_autosave`, menu actions). Check: `scripts/no-direct-fs.sh` (no arguments) prints `no-direct-fs: OK`; `cargo test -p osiris-app` passes.
- [x] 1.4 Add the `scripts/no-direct-fs.sh` step to `scripts/check.sh`. Check: `scripts/check.sh` ends with `CHECK OK`.
