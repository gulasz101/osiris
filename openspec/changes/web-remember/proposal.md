# web-remember: the page keeps the game files after a reload

## Why
The game runs on the live page, but the player picks the Pharaoh folder again after every reload.
The files are read into memory and dropped when the tab goes away; only saves and settings are
stored (`web-persist`). Wojtek wants the page to remember the game files, so a reload goes straight
to the game. This is the first step of stage 2.

## What changes
- `web/opfs.js` (new): the game files are kept in the Origin Private File System
  (`navigator.storage.getDirectory()`), under a folder `game/`, with each file's path relative to
  the game root. Written file by file; `game/.complete` is the marker that says the whole set is
  there. `save(list)`, `restore(mount)`, `forget()` and `available()` are its entry points, plus the
  tree helpers `writeTree`, `readTree`, `hasMarker`, `removeTree` and the skip rule `skipFile`.
  Nothing in `web/store.js` (the IndexedDB saves) changes.
- `web/main.js`: after `findGameRoot` found a root and `start_game` has been called, copy the files
  under the root into `game/` without awaiting, so the start is not slower. On page load, when
  `game/.complete` exists, mount every stored file at `/PharaohData/<path>` and start the game with
  no picker, logging `osiris web: game files restored from browser storage (N files)`.
- `web/index.html`: a small "Forget game files" button that deletes `game/` and reloads, shown once
  a complete copy exists.
- `web/tests/opfs-test.mjs` (new): a Node unit test with an in-memory stand-in for the OPFS folder
  handle, run by `scripts/check.sh`: the skip rule, nested paths, the marker written last, reading
  back what was written, and forgetting.
- `web/tests/smoke.mjs`: `SMOKE_REMEMBER=1` loads the game files through the page's own picker,
  waits for the copy, reloads in the same browser profile, and expects the main menu with no
  picker. It prints `osiris web: remember OK (N files)`.
- `scripts/pages-site.sh` and `scripts/check-site.sh`: `opfs.js` is a page file and may be published.
- `docs/STATUS.md`: drop the "choose your folder again after every reload" line, add a "Works" line
  naming `SMOKE_REMEMBER=1`.

## Out of scope
- The Rust side and game rules. No crate changes: the page mounts the stored bytes the same way it
  mounts the picked ones.
- `web/store.js` and the IndexedDB saves stay exactly as they are.
- No caching of a stale copy keyed by size or date, no background re-copy on every load and no
  progress bar: the copy happens once after a load from the picker.
- The desktop build: nothing in it changes.

## Risks
- The game files are about 775 MB on this machine, so the copy writes a big folder into the
  browser's storage. The page asks for persistent storage (`navigator.storage.persist()`) once and
  checks `navigator.storage.estimate()` first; a browser that says no keeps today's behaviour.
- A copy that fails half way must never look complete, so the marker is removed before the first
  write and written only after the last one.
