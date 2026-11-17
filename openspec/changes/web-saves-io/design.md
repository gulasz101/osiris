# Design: web-saves-io

## Where a save lives, in the browser and on the desktop
`main.rs` already says it. A family's saved games sit in `<user>/families/<sanitized
name>/saves/*.osiris`, where the folder name goes through `sanitize` and the family's real
name is read back from `name.txt` (`family_dir`, `family_saves_dir`, `family_display_name`).
Before families existed the games sat in `<user>/saves/*.osiris` (`legacy_saves_dir`), and
`player_saves_dir()` still picks that folder while no family is chosen. In the browser
`<user>` is `/user`, so the Saves panel lists exactly those two places and nothing else.

`osiris-vfs`'s `read_dir` gives back the original spelling of a path and sorts case-insensitively,
which is all the list needs. `modified` is no use in the browser: on wasm it is a write
sequence number (`modified_seq`), not a clock, so a date read from it would be nonsense.

## The Rust side, so a plain test can prove the bytes
`web.rs` is `#[cfg(target_arch = "wasm32")]`, so a unit test on this machine cannot call it.
The list and the three file operations therefore live in the new `crates/osiris-app/src/saves.rs`,
built for both targets:

```rust
pub const MAX_SAVE_BYTES: usize = 20 * 1024 * 1024;
pub struct Entry { pub family: String, pub name: String, pub path: String, pub size: u64 }
pub fn list(user: &Path) -> Vec<Entry>
pub fn read(user: &Path, path: &str) -> Result<Vec<u8>, String>
pub fn write(saves_dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String>
pub fn delete(user: &Path, path: &str) -> Result<(), String>
```

`saves.rs` does not know about `wasm_bindgen`; it takes the directory it works on as a
parameter, so the test writes a file with `osiris_vfs::write` — the same call the desktop
`quicksave` makes — into a temporary `<user>`, reads it back through `read`, writes those bytes
through `write` into a second family's folder, and compares the two files byte for byte. That is
the issue's unit test, and it runs in `cargo test --workspace` without any game file.

`read` and `delete` take a full path and refuse anything that is not a `.osiris` file directly
inside `<user>/saves` or `<user>/families/<one dir>/saves`, so the page cannot ask for a
setting, a game file, or a file outside the two folders even if the JSON it got back is
tampered with. `write` takes just the file name, because the import's target is the active
family's folder (`player_saves_dir()`), and refuses `/`, `..`, an empty name, a name that is not
`.osiris`, and anything over `MAX_SAVE_BYTES`.

`web.rs` wraps them with `#[wasm_bindgen]` under `/user`, and each wrapper refuses a path that
does not start with `/user/` (the same check `mount_user_file` already does). The import writes
with `osiris_vfs::write`, so `web-persist`'s `/user` change hook sees it and `store.js` puts it
in IndexedDB — one write path, not a second one for imports.

`list_saves()` returns JSON instead of a typed struct because the page only needs four strings
and a number per row, and one JSON string crosses the wasm boundary once instead of a struct
per row:

```json
[{"family":"Smoke","name":"Nubt.osiris","path":"/user/families/smoke/saves/Nubt.osiris","size":184321}]
```

## A date the player can trust
The write time is not in the file and not in the VFS, so the page records it where the bytes
already live. `web/store.js` now stores each `/user` file as `{ bytes, at }`, `at` being
`Date.now()` when the write came in, and `loadAll` still accepts the plain `ArrayBuffer`/
`Uint8Array` values an older page wrote (those saves show no date). A new `dates()` returns the
same map of path to time for the panel, which asks for both in one go when it opens.

## The page
`web/index.html` gains a `Saves` button in the corner controls, next to Fullscreen and Page, and
a `#saves` panel:

```html
<div id="saves" hidden>
    <h2>Saves</h2>
    <table><tbody id="saves-rows"></tbody></table>
    <p id="saves-status"></p>
    <input type="file" id="import" accept=".osiris" />
    <button id="saves-close">Close</button>
</div>
```

The panel is `position: fixed; inset: 0; z-index: 4`, above the progress bar and the canvas, so
it is reachable while the game is playing. `[hidden]` is spelled out again; the page already has
that trap in two places.

`web/saves.js` holds the parts worth testing without a browser:

- `formatSize(bytes)` gives `184.3 kB` / `1.2 MB` (powers of 1024, one decimal above bytes).
- `formatDate(ms)` gives `2026-11-17 10:04` from the browser's own clock, and `—` when there is
  no time.
- `saveName(name)` is the import's own check: it returns `null` for a name with `/` or `..` in
  it, and the name otherwise, so the page refuses before it reads a byte.
- `tooBig(size)` is the 20 MB check (`MAX_SAVE_BYTES`), spelled in JavaScript as well because
  the page should not read a 300 MB file into memory just to be told no by wasm.
- `download(blob, name, { document, url })` makes the object URL, clicks a temporary
  `<a download>`, and revokes the URL. Everything it touches is a parameter, so
  `web/tests/saves-test.mjs` can drive it with fakes.

The download itself is `URL.createObjectURL(new Blob([bytes]))` on an `<a>` with the `download`
attribute, then `URL.revokeObjectURL` once the click is done (MDN `Blob`,
`URL.createObjectURL_static` and the File API guide, read in docs-mcp). `read_save` returns
`Vec<u8>`, and wasm-bindgen copies an owned `Vec<u8>` into a fresh, non-shared `ArrayBuffer`
(wasm-bindgen reference, `--ts-typed-array-buffers`, read in docs-mcp), so the array is safe to
hand to `new Blob([...])` and safe to keep after the call returns.

Each row is a family, a file name, a size, a date, a Download button and a Delete button.
Deleting is not in the issue's row list, but the issue's own smoke run deletes the save and
imports it again; a Delete button is the only way a player can do the same, and it keeps the
smoke run out of the browser's developer tools. It goes through the VFS like every other write,
so IndexedDB forgets the file too, and it asks first.

## The smoke run
`SMOKE_SAVES=1` reuses the menu walk of `SMOKE_MISSION=menu` (new family, Explore History,
mission 0, ToCity) and then:

1. clicks into the canvas and presses `BracketRight` a few times, as the menu run does, and
   waits for `osiris web: city month 1`;
2. presses `F5`. `quicksave` in `main.rs` now logs `osiris web: saved <path> (<n> bytes)` in the
   browser build, which is what the run waits for;
3. opens the Saves panel through its button and reads the first row;
4. waits for the `download` event (Playwright's `page.waitForEvent('download')`, read from the
   Playwright download docs over the web because Playwright is not in docs-mcp), saves it with
   `download.saveAs()` and compares its size with the same path's byte length in IndexedDB
   (`osirisStore.loadAll()` in the page);
5. clicks the row's Delete button, and checks the row is gone from the panel and from
   IndexedDB;
6. imports the downloaded file with `page.setInputFiles("#import", path)`, which runs the page's
   own change handler, and checks the row is back with the same size and the same bytes in
   IndexedDB;
7. closes the panel, presses Escape in the city, clicks the leave confirmation's OK, and on the
   main menu opens Load Saved Game and clicks the save's row twice (the first click picks it,
   the second loads it). The run then waits for `osiris web: city 0 started`.

The leave confirmation is `popup::Confirm`: its origin is
`((screen[0] - 640) / 2).floor() + 80, ((screen[1] - 480) / 2).floor() + 80` and its OK button is
`34x34` at `+256,+100` inside it, so for the smoke run's 1280x768 canvas that is a fixed
`(673, 341)`. The question ("leave for the main menu") is one line, so the button does not move
down with the wrapped-text `extra` offset. The run says where it clicked, so a later change to
the popup shows up as that line plus a failed wait rather than a silent miss.

## What is left alone
`osiris-sim`, the save format, `game::World::save` and `load_game` are untouched: the panel
moves the same `.osiris` bytes the desktop build writes, which is what makes a page save open on
the desktop and the other way round.
