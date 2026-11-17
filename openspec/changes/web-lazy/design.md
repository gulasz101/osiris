# Design: web-lazy

## 1. The read has to be synchronous, on the main thread
Every game read goes through `osiris_vfs::read` / `osiris_vfs::open`, which return the bytes at
once. The game runs on the page's main thread. The browser's synchronous file APIs,
`FileReaderSync` and `FileSystemSyncAccessHandle`, exist only in Web Workers (MDN, docs-mcp
library `mdn-web-apis`: "File API", "Origin private file system"). `Blob.arrayBuffer()` and
`FileReader` are async. Moving the game into a worker is out of scope.

What is left on the main thread: a synchronous `XMLHttpRequest` to the file's `blob:` URL.
- `URL.createObjectURL(file)` once per file when it is registered; keep the URL.
- `xhr.open("GET", url, false)`. A synchronous request in a window may not set `responseType`
  (the browser throws `InvalidAccessError`), so leave it at the default and call
  `xhr.overrideMimeType("text/plain; charset=x-user-defined")`. Then `xhr.responseText` holds one
  character per byte: `bytes[i] = text.charCodeAt(i) & 0xff`.
- A `blob:` URL answers with `status` 200. Anything else, or an exception, is a failed read.
- Chromium logs a console warning about synchronous XHR on the main thread. That is expected. It
  is a warning, not an error, and the smoke test must not fail on it.

Task 1.2 proves this works in the smoke test's Chromium before any other task builds on it, and
writes the time for a 40 MB file here. If it does not work, stop: block the issue with the
error. Do not try a different mechanism without a new plan.

Measured (task 1.2): `osiris web: sync read OK (40 MB in 502 ms)` from
`SMOKE_SYNCREAD=1 scripts/web-smoke.sh`. All 40 MB came back byte for byte in one synchronous
`XMLHttpRequest`, and a path the page never registered threw an error naming that path. Half a
second for a file that size is slow enough that nothing on the start path may read a large file
twice, so a lazy entry keeps no bytes (design 3).

## 2. `web/files.js`
```js
const files = new Map(); // VFS path as mounted (e.g. "/PharaohData/Data/x.sg3") -> { file, url }
export function register(vfsPath, file) { /* createObjectURL once, store */ }
export function read(vfsPath) { /* sync XHR as in 1; returns Uint8Array; throws Error naming the path */ }
export function count() { return files.size; }
globalThis.osirisFiles = { read };
```
The key is the exact string Rust stores as the entry's original path: `"/" + <path passed to
mount_lazy>` (the same transform `mount_file` does in `web.rs`). Rust always asks with that
original string, so the map needs no case folding.

## 3. Lazy entries in `MemFs`
`Entry.data: Arc<[u8]>` becomes `Entry.data: Data` with
```rust
enum Data { Bytes(Arc<[u8]>), Lazy { len: u64 } }
```
- `MemFs::mount_lazy(path, len)` adds a `Lazy` entry and its parent directories, like `mount`.
- `MemFs::read(path)` keeps its signature (`Option<Arc<[u8]>>`). For `Lazy` it calls the reader
  hook with `entry.original` and returns the bytes **without storing them**. No reader set, or the
  reader returns `None`: `None` (callers already turn that into `NotFound`).
- `len`, `is_file`, `exists`, `read_dir`, `modified` work on `Lazy` entries without reading.
- `write` over a lazy path replaces it with `Bytes`, as for any file. `remove_file` removes it.
- `rename` of a `Lazy` entry first reads it and stores `Bytes`, then renames, because the JS map
  is keyed by the old path. (The game never renames its own install; this keeps it correct.)
- The reader hook: `pub fn set_lazy_reader(reader: fn(&str) -> Option<Vec<u8>>)` in `lib.rs`,
  stored in a `thread_local! Cell<Option<fn(&str) -> Option<Vec<u8>>>>`, the same pattern as
  `set_change_hook`. Not storing the bytes is deliberate: the game decodes most files once, and
  a cache would bring back the memory this change removes. A file read twice is read from disk
  twice.
- The change hook (`watch("/user")`) is not fired by `mount_lazy`: game files live outside `/user`.

## 4. `web.rs`
```rust
#[wasm_bindgen]
pub fn mount_lazy(path: String, len: f64)   // same path transform as mount_file; u64 from f64
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = osirisFiles, js_name = read)]
    fn files_read(path: &str) -> Result<Vec<u8>, JsValue>;
}
fn lazy_read(path: &str) -> Option<Vec<u8>>   // Err -> log::warn!("osiris web: reading {path} failed: {err:?}") -> None
```
Register it next to `set_change_hook` in the logger/init function (`web.rs` around line 197):
`osiris_vfs::set_lazy_reader(lazy_read)`. Check the wasm-bindgen docs in docs-mcp for `catch`
and `Vec<u8>` returns before writing it.

## 5. The page
- Picker (`web/main.js`, the `readAll(...)` call that mounts `"PharaohData/" + entry.path`):
  for each entry, `register("/PharaohData/" + entry.path, entry.file)` and
  `mount_lazy("PharaohData/" + entry.path, entry.file.size)`. No bytes are read, so no progress
  bar. Replace the `read N files in M ms` log with
  `osiris web: indexed N files (X MB) in M ms`. `copyToStorage(files)` stays as it is.
- OPFS restore (`web/opfs.js`, `readTree` / `restore`): walk the tree as now, but for each file
  `const file = await entry.handle.getFile()` and call `onFile(path, file)` with the `File`,
  not its bytes. In `main.js` the callback becomes
  `(path, file) => { register("/" + path, file); mount_lazy(path, file.size); }`.
  Keep the `game files restored from browser storage (N files)` log line: the remember run waits
  for it.
- `mount_file` stays exported (smaller diff); nothing on the start path calls it any more.

## 6. Memory
wasm memory grows to its high-water mark and never gives it back. After this change the high
water is what the game holds decoded (textures, the city) plus the largest files it reads at the
same moment. The target is `memory start` below 300 MB in the soak run. The soak line already
prints it; no new logging.

Measured (task 1.6): `OSIRIS_DATA=<folder> SMOKE_SOAK=1 scripts/web-smoke.sh` prints
`osiris web: soak OK (24 months, min fps 6, memory start 245 MB end 245 MB)` and
`osiris web: custom map soak OK (6 months on Small Oasis, min fps 8, memory start 245 MB end
245 MB)`, against `memory start 931 MB end 931 MB` before this change. The month lines hold at
`256638976` bytes from month 0 to month 11, so the high water is the game's decoded data, not
the install.

## 7. Movies and sound
`osiris_bink::Movie::new(osiris_vfs::open(path)?)` and the audio loaders use `open`, which goes
through `MemFs::read`, so a movie or a sound is read from disk when it starts and dropped when
it ends. Nothing in those crates changes.
