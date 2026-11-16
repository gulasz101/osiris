# Tasks: web-persist

- [x] 1.1 `Change`, `MemFs::watch` and `MemFs::take_changes` with unit tests in `mem.rs`: write, remove_file, remove_dir_all, rename of a file and of a directory, mixed-case paths, and nothing recorded without `watch` or outside the prefix. Check: `cargo test -p osiris-vfs` passes.
- [x] 1.2 wasm `watch`, `set_change_hook` and `flush` in `lib.rs` (design.md: the hook runs outside the borrow). Check: `cargo check --target wasm32-unknown-unknown -p osiris-vfs` exits 0.
- [x] 1.3 `web.rs`: JS imports, hook in `init()`, `mount_user_file`, `debug_write_user`, `debug_read_user`. Check: `cargo check --target wasm32-unknown-unknown -p osiris-app` exits 0.
- [x] 1.4 `web/store.js` and its `<script>` tag before `main.js` in `index.html`. Check: `scripts/build-web.sh` succeeds and the console shows no `osirisStore` error in `scripts/web-smoke.sh`.
- [x] 1.5 `main.js` restores stored files before the folder button. Check: `scripts/web-smoke.sh` prints `osiris web: restored 0 user files` on a fresh browser.
- [x] 1.6 Smoke test write, reload, read (design.md). Check: `scripts/web-smoke.sh` prints `osiris web: persist OK` and exits 0.
- [x] 1.7 `scripts/check.sh` ends with `CHECK OK`.
