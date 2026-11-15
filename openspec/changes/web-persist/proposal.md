# web-persist: keep saves and settings in the browser across page loads

## Why
In the browser, saves and settings live under `/user` in the in-memory store (web-vfs). They are
lost when the page closes. The player must find their saved games and settings again after a reload.

## What changes
- `osiris-vfs` `MemFs`: an optional watched prefix (`/user`). Every write, delete and rename under
  it is recorded as a `Change` (`Put(path, bytes)` or `Delete(path)`). Desktop code is unchanged.
- `osiris-vfs` (wasm only): `set_change_hook(fn(Change))`; `write`, `remove_file`,
  `remove_dir_all` and `rename` pass the recorded changes to the hook after the store is updated.
- `src/web.rs`: `init()` watches `/user` and sets a hook that calls JS `osirisStore.put` /
  `osirisStore.del`. New export `mount_user_file(path, bytes)` puts a file under `/user` without
  calling the hook. Two small exports for the smoke test: `debug_write_user(name, text)` and
  `debug_read_user(name)`.
- `web/store.js` (new): IndexedDB database `osiris`, object store `user`, key = path, value = bytes.
  `loadAll()`, `put(path, bytes)`, `del(path)`; writes run in order on one promise chain.
- `web/main.js`: after `init()`, load every stored file and pass it to `mount_user_file`, log
  `osiris web: restored N user files`, then show the folder button as before.
- Smoke test: write a user file, reload the page, read it back.

## Out of scope
Keeping access to the Pharaoh folder itself (the player chooses it again on every load), export
or import of saves, quota warnings.
