# web-drop: drag the Pharaoh folder onto the page

## Why
Today the player must click the folder button and find Pharaoh in a file dialog. Dragging the
folder from the file manager onto the page is faster and is what most people try first.

## What changes
- `web/folder.js` (new, ES module): `filesFromInput(fileList)` and `filesFromDrop(dataTransfer)`.
  Both return the same list `[{ path, file }]`, where `path` is relative to the folder the player
  chose (the first path part is dropped, as `mount_file` expects today).
- `web/main.js`: the code web-start wrote for `#folder` `change` moves into one function
  `loadFolder(list)`; the input and the drop both call it.
- `web/index.html`: `#start` is the drop zone; text "or drag the Pharaoh folder here"; a CSS class
  `drag` while a drag is over it.
- Smoke test: the walker is tested with fake entries, and a synthetic drop reaches `loadFolder`.

## Out of scope
Dropping a zip or the CD image, dropping onto the running game, keeping access to the folder
after reload (File System Access API).
