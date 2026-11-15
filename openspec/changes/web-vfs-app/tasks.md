# Tasks: web-vfs-app

- [ ] 1.1 Add `osiris-vfs = { path = "../osiris-vfs" }` to `crates/osiris-app/Cargo.toml`; switch `data_dir.rs`, `sound_options.rs`, `lang.rs`. Check: `scripts/no-direct-fs.sh crates/osiris-app/src` lists none of these three files; `cargo test -p osiris-app` passes.
- [ ] 1.2 Switch `gfx.rs` (including the PNG case in design.md), `menu.rs`, `movie.rs`, `game.rs`. Check: none of these files listed; `cargo test -p osiris-app` passes.
- [ ] 1.3 Switch `editor/mod.rs`, `editor/kingdom.rs`, `editor/script.rs`, `script.rs`. Check: `scripts/no-direct-fs.sh crates/osiris-app/src` lists only `main.rs` lines; `cargo test -p osiris-app` passes.
- [ ] 1.4 `scripts/check.sh` ends with `CHECK OK`.
