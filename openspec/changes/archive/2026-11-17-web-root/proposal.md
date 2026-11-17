# web-root: find the game folder anywhere inside the folder the player picks

## Why
Wojtek picked his whole GOG folder `pharaoh-plus-cleopatra/` in Chrome. The game files are two
levels down, in `Akhenaten/resources/` (`Pharaoh.exe`, `Data/Pharaoh_General.sg3`). The page read
all 1345 files and then `start_game` failed with "This folder does not hold Pharaoh's Data folder".

`web/folder.js` strips only the first path part, so a file at
`Akhenaten/resources/Data/Pharaoh_General.sg3` reaches `start_game` with its paths still under
`Akhenaten/resources/`, and `start_game` in `crates/osiris-app/src/web.rs` only accepts files
mounted at `/PharaohData/Data`. The game root has to be the folder that holds `Data/`, wherever it
sits inside the chosen folder, and everything under it has to be mounted as if the player had
picked that folder directly.

## What changes
- `web/folder.js`: new exported `findGameRoot(list)`. It takes the flat `[{ path, file }]` list the
  walker already produces and returns the shortest directory prefix `P` for which
  `P + "Data/Pharaoh_General.sg3"` is in the list, compared case-insensitively, with a trailing
  `/`; `""` when the chosen folder itself is the root; `null` when there is no such folder.
  Also `filesUnder(root, list)`, which keeps only the entries under `root` and returns them with
  the root prefix removed.
- `web/main.js` (`loadFolder`, one place for the file picker and for drag and drop): find the root
  before reading a single byte. No root: put the existing refusal text in `#status` and read
  nothing. A root: read only the files under it, mount each at `/PharaohData/<path relative to the
  root>` (the path `start_game` looks for), skip everything outside the root (zips, `extras/`,
  `akhenaten.linux`), and say in `#status` how many files are being read.
- `web/tests/folder-test.mjs`: a Node unit test for `findGameRoot` and `filesUnder`, run by
  `scripts/check.sh`: root at depth 0, depth 1, depth 3 (the GOG tree), a lower-case
  `data/pharaoh_general.sg3`, and no root at all.
- `web/tests/smoke.mjs`: `SMOKE_WRAP=outer/inner` stages the game files two folders deeper and
  loads them through the page's own folder picker, so the browser run proves the root is found and
  the city still runs. Without `SMOKE_WRAP` the smoke test behaves as it does today.
- `docs/STATUS.md`: one line saying the player can pick the GOG folder or any folder above the
  game files.

## Out of scope
- The Rust side. `start_game` keeps its `/PharaohData/Data` check and its message; the page now
  meets it. No change to game rules, rendering or the desktop build.
- Remembering the game root between page loads (the player picks the folder again after a reload,
  as `docs/STATUS.md` already says).
