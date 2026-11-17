# web-saves-io: take a save out of the browser, and put one back

## Why
Saves written in the browser live in IndexedDB under `/user` (`web-persist`) and cannot leave
it. A player cannot back one up, cannot move a city to another computer, and cannot open a city
they played in the desktop Osiris. The save format is already the desktop's; only the way in and
out of the browser's storage is missing.

## What changes
- `crates/osiris-app/src/saves.rs` (new, built for desktop and browser): the save list and the
  three file operations, with no `wasm_bindgen` in them so a plain `cargo test` can prove the
  bytes. `list(user)` walks `<user>/saves/*.osiris` (the pre-family folder) and
  `<user>/families/<dir>/saves/*.osiris`, naming each family the way `family_dir`/
  `family_display_name` in `main.rs` do. `read(user, path)` refuses a path outside the two saves
  folders. `write(saves_dir, name, bytes)` refuses a name with `/` in it, a name holding `..`, and
  anything over `MAX_SAVE_BYTES` (20 MB). `delete(user, path)` uses the same refusal as `read`.
- `crates/osiris-app/src/web.rs`: `list_saves()` as JSON (`family`, `name`, `path`, `size`),
  `read_save(path) -> Uint8Array`, `write_save(name, bytes) -> String` (the path it wrote) and
  `delete_save(path)`, all through `saves.rs` and all refusing anything not under `/user/`.
  The import writes into the active family's saves folder, so it goes through the same
  `osiris_vfs::write` + `/user` change hook that `web-persist` uses and is kept in IndexedDB.
- `web/saves.js` (new): the list's formatting (`formatSize`, `formatDate`, `saveName`), the
  download (a `Blob` and an `<a download>`), and the import's own checks, so the same rules can
  be unit-tested without a browser.
- `web/index.html`: a `Saves` button in the corner controls and a `#saves` panel over the page
  with the list, an `Import save` file input and a Close button.
- `web/main.js`: opens and closes the panel, fills the list from `list_saves()`, downloads a
  row through `read_save(path)`, deletes a row, and imports a file through `write_save`.
- `web/store.js`: each stored file gets the time it was written (`{ bytes, at }`), so the list's
  date is a real date; `loadAll` still accepts the plain values older visits wrote, and the new
  `dates()` gives the page the times it needs for the list.
- `crates/osiris-app/src/main.rs`: the browser build logs `osiris web: saved <path> (<n> bytes)`
  when `quicksave` writes a save, so the smoke run knows when the save is in the store.
- `web/tests/saves-test.mjs` (new): the size and date text, the name refusals, and the download
  helper making one Blob URL and revoking it. Added to `scripts/check.sh`,
  `scripts/pages-site.sh` and `scripts/check-site.sh`.
- `web/tests/smoke.mjs`: `SMOKE_SAVES=1` starts mission 0 from the menu, runs a month, saves with
  F5, opens the Saves panel, downloads the save, checks the file's size against IndexedDB,
  deletes it, imports it again with the file input, and loads it from the game's Load Saved Game
  screen. It prints `osiris web: saves export/import OK`.
- `docs/STATUS.md`: the "copying a save is not possible" line goes, a "Works" line for the Saves
  panel arrives, and `SMOKE_SAVES=1` is listed in the checks section.

## Out of scope
- The save format, the game's own Save and Load screens, and the desktop's save folders. A save
  the page downloads is the same file the desktop build writes and reads.
- Settings files (`rules.toml`, `difficulty.txt`, `window.txt`, campaign progress): the panel
  lists saved games only, the `.osiris` files under a family's `saves` folder.
- Uploading anything anywhere. The download is a local file and the import reads a local file.
- Renaming, editing or copying a save inside the browser.

## Risks
- A save can be larger than a city's usual few megabytes; the 20 MB cap is the issue's number and
  the import refuses anything above it rather than the browser dying on the read.
- Deleting a save from the panel deletes it from IndexedDB as well, because the delete goes
  through the VFS. A mis-click loses a city. The row asks before it deletes.
- The stored value in IndexedDB changes shape (bytes plus the write time). A record written by an
  older page must still load; `loadAll` keeps reading plain byte values, and those saves simply
  show no date.
- The smoke run has to leave the city to reach the main menu's load screen, which means clicking
  the game's own leave-confirmation popup at a fixed place on the canvas. `design.md` records the
  place and why it is stable.
