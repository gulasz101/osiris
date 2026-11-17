# web-title: tasks

## 1. Artwork
- [x] 1.1 Generate the title and loading artwork with the Image Studio (`nanobanana`), save it as
      JPEG under `web/assets/` (title.jpg, archive.jpg, both under 250 KB).

## 2. The game tells the page it is ready
- [x] 2.1 `web::notify_ready()` calls `globalThis.osirisReady` when it is a function;
      `finish_start` calls it on wasm. `cargo check --target wasm32-unknown-unknown -p osiris-app`.

## 3. The page
- [x] 3.1 Title screen and menu in `web/index.html`; Enter, folder, Saved games, Forget.
- [x] 3.2 `web/main.js`: pick and restore show Enter; Enter shows `#loading` and starts the game;
      `osirisReady` takes the loading screen down and shows the controls.
- [x] 3.3 Saved games manager restyled, opened from the title screen too, Escape closes it.

## 4. Publishing and tests
- [x] 4.1 `pages-site.sh` copies `web/assets/*.jpg`; `check-site.sh` allows `assets/*.jpg`.
- [x] 4.2 `smoke.mjs` presses Enter in the pick and remember runs.
- [x] 4.3 `OSIRIS_DATA=<folder> SMOKE_PICK=1`, `SMOKE_REMEMBER=1` and `SMOKE_MISSION=menu SMOKE_SAVES=1`
      smoke runs pass; `scripts/check.sh` ends with `CHECK OK`.
