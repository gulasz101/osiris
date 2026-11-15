# Tasks: web-time-threads

## 1. Clock
- [x] 1.1 Add `web-time = "1.1"` to `crates/osiris-ui` and swap `Instant` in `src/dialog.rs`. Check: `cargo test -p osiris-ui` passes and `cargo check --target wasm32-unknown-unknown -p osiris-ui` exits 0.
- [x] 1.2 Add `web-time = "1.1"` to `crates/osiris-app` and swap every `std::time::Instant` / `SystemTime` in its non-test code (list in design.md). Check: the grep in design.md prints nothing for `crates/osiris-app/src` outside `mod tests`, and `cargo check -p osiris-app` plus the wasm check both exit 0.

## 2. Threads
- [x] 2.1 Autosave: add `write_autosave` and the two cfg branches in `main.rs`. Check: `cargo test -p osiris-app autosaves_rotate` passes; wasm check exits 0.
- [x] 2.2 Movies: return `None` in the browser and gate `Movie::run`. Check: `cargo test -p osiris-app` passes; wasm check exits 0; `grep -n 'thread::' crates/osiris-app/src/*.rs` shows only lines under `#[cfg(not(target_arch = "wasm32"))]`.

## 3. Close
- [x] 3.1 `scripts/check.sh` ends with `CHECK OK`.
