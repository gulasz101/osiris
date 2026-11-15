# Tasks: web-vfs-core

## 1. The crate
- [x] 1.1 Create `crates/osiris-vfs` with `Cargo.toml` and `src/mem.rs` (`MemFs` + its tests, see design.md). Check: `cargo test -p osiris-vfs` passes with at least 9 tests.
- [x] 1.2 Write `src/lib.rs`: the public API, desktop bodies on `std::fs`, browser bodies on the thread-local `MemFs`, and `mount`. Check: `cargo test -p osiris-vfs` passes and `cargo check --target wasm32-unknown-unknown -p osiris-vfs` exits 0.

## 2. Game-data crates
- [x] 2.1 `osiris-formats` uses `osiris_vfs`. Check: `scripts/no-direct-fs.sh crates/osiris-formats/src` prints `no-direct-fs: OK` and `cargo test -p osiris-formats` passes.
- [ ] 2.2 `osiris-sim` uses `osiris_vfs`. Check: `scripts/no-direct-fs.sh crates/osiris-sim/src` prints OK and `cargo test -p osiris-sim` passes (give the call `timeout: 1500`).
- [ ] 2.3 `osiris-audio` uses `osiris_vfs`. Check: `scripts/no-direct-fs.sh crates/osiris-audio/src` prints OK and `cargo test -p osiris-audio` passes.
- [ ] 2.4 `osiris-bink` uses `osiris_vfs::open` / `osiris_vfs::Reader`. Check: `scripts/no-direct-fs.sh crates/osiris-bink/src` prints OK, `cargo test -p osiris-bink` passes and `cargo check -p osiris-app` exits 0 (`movie.rs` names the reader type; change `std::io::BufReader<std::fs::File>` there to `osiris_vfs::Reader` in the same commit).

## 3. Close
- [ ] 3.1 `scripts/check.sh` ends with `CHECK OK`.
