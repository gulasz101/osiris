# Design: web-drop

Look up first, in docs-mcp `mdn-web-apis`: `DataTransferItem.webkitGetAsEntry`,
`FileSystemDirectoryEntry.createReader`, `FileSystemDirectoryReader.readEntries`,
`FileSystemFileEntry.file`, `dragover` / `drop` events. No new Rust code and no new crate.
Start after web-start is archived: `main.js` must already read `#folder` and call `start_game`.

## web/folder.js
```js
export function filesFromInput(fileList)      // -> [{ path, file }]
export async function filesFromDrop(dataTransfer) // -> [{ path, file }]
export async function walk(entry, prefix)     // -> [{ path, file }], exported for the test
```
- `filesFromInput`: `path` = `file.webkitRelativePath` without its first part (same rule as
  web-start's design.md, "Exports").
- `filesFromDrop`: take `dataTransfer.items` SYNCHRONOUSLY at the start (the list is emptied
  after the first `await`): `const entries = [...items].map(i => i.webkitGetAsEntry()).filter(Boolean)`.
  If exactly one entry and it `isDirectory`: `walk(entry, "")` (the dropped folder itself is the
  first part, so it is not in `path`). Otherwise walk every entry with prefix `""` (the player
  dropped the inside of the folder). If `entries` is empty, fall back to `[...dataTransfer.files]`
  with `path = file.name`.
- `walk`: a file entry gives `{ path: prefix + entry.name, file: await fileOf(entry) }` where
  `fileOf` wraps `entry.file(ok, err)` in a Promise. A directory: create ONE reader and call
  `readEntries` in a loop until it returns an empty array (Chromium returns at most 100 per call;
  one call is a bug that loses files), then walk each child with `prefix + entry.name + "/"`.
- Paths always use `/`.

## web/main.js
- `async function loadFolder(list)`: the body web-start wrote for `change` (mount every file with
  `mount_file("/" + ...)` exactly as now, status every 50 files, hide `#start`, `start_game()`,
  error shows `#start` again). Do not change what it mounts; only its input is now `list`.
- Before it starts, log `osiris web: loading N files`.
- `#folder` `change`: `loadFolder(filesFromInput(input.files))`.
- `#start`: `dragover` -> `preventDefault()`, add class `drag`; `dragleave` -> remove it;
  `drop` -> `preventDefault()`, remove class, `loadFolder(await filesFromDrop(e.dataTransfer))`.
  Ignore a second drop while a load runs (one `busy` flag).

## web/index.html
Under the button: `<p>or drag the Pharaoh folder here</p>`. CSS: `#start.drag { outline: 3px dashed #ffd700; }`.

## Smoke test (web/tests/smoke.mjs), no game data needed
1. Walker: `page.evaluate` imports `./folder.js` and calls `walk` on fake entries: a directory
   `Pharaoh` whose reader returns 150 files in batches of 100, 50, then `[]`, plus a subfolder
   `Data` with one file `a.sg3`. Expect 151 results and a path `Data/a.sg3`; else print
   `FAIL: folder walk` and exit 1.
2. Drop: build `new DataTransfer()` with one `File` named `x.txt`, dispatch a `drop` event on
   `#start`. Synthetic items have no entries, so this tests the fallback. Wait for
   `osiris web: loading 1 files`; the game then fails with "This folder does not hold Pharaoh's Data
   folder." and `#start` must be visible again.
Print `osiris web: drop OK` when both pass.
