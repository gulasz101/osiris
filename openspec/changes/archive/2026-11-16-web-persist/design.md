# Design: web-persist

Look up first, in docs-mcp: `mdn-web-apis` (IndexedDB: `indexedDB.open`, `onupgradeneeded`,
`IDBObjectStore.put` / `delete` / `getAll` / `getAllKeys`, transactions), `wasm-bindgen`
(`#[wasm_bindgen(js_namespace = ...)]` imports, `&[u8]` arguments, `Option<String>` returns).
No new Rust crate: IndexedDB is used from JavaScript only.

## MemFs change log (crates/osiris-vfs/src/mem.rs, all targets)
```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change { Put(String, Vec<u8>), Delete(String) }

impl MemFs {
    /// Record changes to files whose path starts with `prefix` (case-insensitive, e.g. "/user").
    pub fn watch(&mut self, prefix: &str);
    /// Return and clear the recorded changes, oldest first.
    pub fn take_changes(&mut self) -> Vec<Change>;
}
```
Rules (paths in `Change` use the stored spelling, the same as `read_dir` returns):
- `write(p, data)` under the prefix: `Put(p, data)`.
- `remove_file(p)` that returns true: `Delete(p)`.
- `remove_dir_all(d)`: `Delete` for every file under `d`, collected before removal.
- `rename(a, b)` that returns true: for every file moved (one file, or all files under a directory)
  `Delete(old)` then `Put(new, bytes)`. If only one side is under the prefix, record only that side.
- `mount` and `create_dir_all` record nothing (directories exist implicitly in IndexedDB).
- With no `watch` call nothing is recorded, so desktop tests and game-data mounts cost nothing.
Re-export `Change` from `lib.rs`.

## Hook (crates/osiris-vfs/src/lib.rs, wasm only)
```rust
thread_local! { static HOOK: Cell<Option<fn(Change)>> = Cell::new(None); }
pub fn watch(prefix: &str);                 // FS.with(|fs| fs.borrow_mut().watch(prefix))
pub fn set_change_hook(hook: fn(Change));
fn flush() // take_changes inside FS.with, then call HOOK for each change OUTSIDE the borrow
```
Call `flush()` at the end of `write`, `remove_file`, `remove_dir_all` and `rename`. The hook must
run after `borrow_mut()` is dropped, or a hook that reads the store would panic.

## Browser glue (crates/osiris-app/src/web.rs)
```rust
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = osirisStore, js_name = put)]
    fn store_put(path: &str, bytes: &[u8]);
    #[wasm_bindgen(js_namespace = osirisStore, js_name = del)]
    fn store_del(path: &str);
}
```
In `init()`: `osiris_vfs::watch("/user")` and `osiris_vfs::set_change_hook(on_change)`.
`#[wasm_bindgen] pub fn mount_user_file(path: String, bytes: Vec<u8>)`: `path` is the full stored
path (starts with `/user/`); reject anything else with a `log::warn!`. Uses `osiris_vfs::mount`, so
no hook call.
`#[wasm_bindgen] pub fn debug_write_user(name: String, text: String)`: `osiris_vfs::write` to
`/user/<name>`. `#[wasm_bindgen] pub fn debug_read_user(name: String) -> Option<String>`.
Both are only for the smoke test; one doc line says so.

## web/store.js
Defines `globalThis.osirisStore = { open, loadAll, put, del }` and is loaded by `index.html` as a
classic `<script>` BEFORE `main.js`, so the wasm imports find it.
- `open()`: `indexedDB.open("osiris", 1)`; on upgrade create store `user` (out-of-line keys).
- `loadAll()`: one read transaction, `getAllKeys()` + `getAll()`, returns `[path, Uint8Array][]`.
- `put(path, bytes)`: copy `bytes` (`bytes.slice()`: the wasm memory view is not safe to keep),
  then chain on one module-level promise a readwrite transaction `put(copy, path)`.
- `del(path)`: same chain, `delete(path)`.
- Errors: `console.error("osiris store: ...")`, never throw into wasm.
Expose `osirisStore.idle()` returning the current chain promise (the smoke test awaits it).

## web/main.js
After `await init()`: `await osirisStore.open()`, `for (const [p, b] of await osirisStore.loadAll())
mount_user_file(p, b)`, `console.log(\`osiris web: restored ${n} user files\`)`. Then the folder
button as today. A failure to open IndexedDB (private mode) logs a warning and continues without
persistence.

## Smoke test (web/tests/smoke.mjs)
After `osiris web: ready`: `page.evaluate` imports `./pkg/osiris.js` and calls
`debug_write_user("smoke.txt", "kept")`, then `await osirisStore.idle()`. Reload the page, wait for
`osiris web: restored`, then `debug_read_user("smoke.txt")` must be `"kept"`; else print
`FAIL: user file not kept` and exit 1. Use one browser context for both loads (IndexedDB is per
context). Print `osiris web: persist OK` on success.
