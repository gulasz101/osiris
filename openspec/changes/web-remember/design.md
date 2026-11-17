# Design: web-remember

Looked up in docs-mcp first, library `mdn-web-apis`:
`StorageManager.getDirectory`, `File_System_API/Origin_private_file_system`,
`StorageManager.persist`, `StorageManager.estimate`. The quotes the code follows:

- "To access the OPFS in the first place, you call the `navigator.storage.getDirectory()` method.
  This returns a reference to a `FileSystemDirectoryHandle` object that represents the root of the
  OPFS." (mdn-web-apis, `File_System_API/Origin_private_file_system`)
- "Passing `{ create: true }` into the above methods causes the file or folder to be created if it
  doesn't exist." (same page, about `getFileHandle()` / `getDirectoryHandle()`)
- Writing a file: "`FileSystemFileHandle.createWritable()` to return a
  `FileSystemWritableFileStream` ... write contents to it using a
  `FileSystemWritableFileStream.write()` call ... close the stream using `WritableStream.close()`."
  (same page)
- "You can call `FileSystemDirectoryHandle.removeEntry()` on the parent directory, passing it the
  name of the item to delete. To delete a folder including all subfolders, pass the
  `{ recursive: true }` option." (same page)
- "`FileSystemDirectoryHandle` is an asynchronous iterator ... you can iterate over it with a
  `for await...of` loop" (same page), which is how the stored tree is walked back.
- "`persist()` ... returns a `Promise` that resolves to `true` if permission is granted and bucket
  mode is persistent, and `false` otherwise." (mdn-web-apis, `StorageManager/persist`)
- "`estimate()` ... resolves to an object with `quota` ... and `usage`." (mdn-web-apis,
  `StorageManager/estimate`)

No new Rust crate and no wasm change: this is JavaScript only.

## Storage layout
One folder `game/` directly under the OPFS root, mirroring the game root:

```
game/Data/Pharaoh_General.sg3      <- was <root>Data/Pharaoh_General.sg3
game/AUDIO/Wavs/x.wav
game/.complete                     <- written last, holds the file count
```

The marker is what the next load trusts. `save()` removes it before the first write and writes it
after the last one, so a copy that stops half way (the tab closed, the quota ran out) is never
mounted. Nothing else in the OPFS is touched, so a future save export in `game/` stays possible.

## `web/opfs.js`
Pure tree helpers, so a Node test can drive them with an in-memory folder handle:
```js
export function skipFile(path)             // true for .pdf .zip .dll .asi .m3d .tsk (lower case)
export async function writeTree(dir, list, { onProgress })
export async function readTree(dir, onFile)      // awaits onFile(path, bytes) per file
export async function hasMarker(dir)
export async function removeTree(dir)            // removeEntry("game", { recursive: true })
```
Browser entry points:
```js
export function available()              // navigator.storage.getDirectory is a function
export async function save(list)         // persist, estimate, writeTree, marker -> count
export async function restore(mount)     // mount("PharaohData/" + path, bytes) per file -> count
export async function forget()           // removeTree on the OPFS root
```
The module is imported by `main.js` (`import ... from "./opfs.js"`), not added as a classic script:
no wasm import reaches into it, unlike `osirisStore` in `store.js`.
`web/opfs.js` is copied by `scripts/pages-site.sh` and named in `scripts/check-site.sh`'s allow list.

## Rules
- Skip list, compared on the lower-cased path: `.pdf`, `.zip`, `.dll`, `.asi`, `.m3d`, `.tsk`. These
  are the manual, the archives, the Windows shims and the mission-editor leftovers the engine never
  reads.
- `save()` asks `navigator.storage.persist()` once, then `estimate()`: when
  `quota - usage` is smaller than the bytes still to be written, log one warning and keep today's
  behaviour (pick every time). Any other failure (no OPFS, a write throwing, the quota running out)
  also logs one warning and removes the partial `game/`, so the next load asks for the folder.
- `save()` is called without `await` after `start_game`, and it awaits each file's write, so the
  game's frames keep running between files.
- `restore()` runs before the picker is shown. It mounts each stored file with `mount_file` (the
  same function `loadFolder` uses) and returns the count; `main.js` then starts the game. A thrown
  `start_game` (a copy that is missing `Data/`) logs a warning, forgets the copy and shows the
  picker, so a bad copy never blocks the game.
- Progress goes to the console every 100 files: `osiris web: copied 100/1335 game files to browser
  storage`. One line marks the end: `osiris web: game files copied to browser storage (N files)`.
  The smoke test waits for that line.

## `web/index.html`
```html
<button id="forget" hidden>Forget game files</button>
```
Fixed to the bottom-right corner, small and half transparent, so it is reachable while the game
covers the page (the start div is hidden once the game runs). Clicking it calls `forget()` and then
`location.reload()`.
