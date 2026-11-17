# Osiris Web: what the browser build does today

This page says what the browser build can do, how to run it, and what is still missing. It is
written for the player, not for the developer. The desktop build does not change.

The page ships no game data. Not one file from Pharaoh or Cleopatra is in this repo or in the
published site. The player chooses their own install on their own computer.

The engine behind the page is the desktop Osiris, version 0.1.17. The fork is merged up to
`joemalott/osiris` 0.1.17, so the browser build has the same game rules as the desktop build.

## 1. Run it

You need a recent stable Rust toolchain, the `wasm32-unknown-unknown` target, and the
`wasm-bindgen` command line tool in the same version as the one in `Cargo.lock`:

```
rustup target add wasm32-unknown-unknown
V=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"/\1/p')
cargo install wasm-bindgen-cli --version "$V" --locked
```

Then build the page and serve it from a checkout:

```
scripts/build-web.sh
python3 -m http.server 8000 -d web
```

Open http://localhost:8000/ in the browser.

The published copy of the same page is at https://gulasz101.github.io/osiris/.

On the page, either click on the folder field and pick your Pharaoh install, or drag the Pharaoh
folder onto the page. The page reads it in memory and the game starts. Nothing is uploaded and
nothing leaves your computer; saves and settings are kept in the browser's own storage.

Pick the folder that holds `Pharaoh.exe`, or any folder above it: the page looks for
`Data/Pharaoh_General.sg3` at any depth, so your whole GOG folder (with the game down in
`Akhenaten/resources/`) works as well as `resources/` itself.

`?mission=N` in the address starts mission `N` straight away, the way `--mission N` does on the
desktop. `?mission=0` is Nubt, the first mission.

## 2. Works

Each line names the finished OpenSpec change behind it and the command that proves it. The
smoke command is `scripts/web-smoke.sh`, which builds the page, opens it in a headless Chromium
and reads the page's console. Add `OSIRIS_DATA=<your Pharaoh folder>` to give it the game files.

- **The game runs in the page.** The program compiles for the browser and the page loads it
  without a panic (`web-compiles`, `web-page`). `scripts/web-smoke.sh` prints
  `osiris web: ready`.
- **Files come from memory, not the disk.** Nothing in the browser build calls `std::fs`; the
  game reads the player's folder through one file layer that the desktop build backs with real
  files (`web-vfs-core`, `web-vfs-app`, `web-vfs-main`). `scripts/no-direct-fs.sh` prints OK, and
  `OSIRIS_DATA=<folder> scripts/web-smoke.sh` mounts 1335 files and prints
  `osiris web: all essential game files mounted, starting game...`.
- **No clock or thread call panics.** Frame timing and autosaves use `web_time`, and the browser
  never starts a thread (`web-time-threads`). The same smoke run reaches the menu with no
  `not implemented on this platform` panic in the console.
- **The main menu.** The player's folder is mounted and the game opens on its main menu
  (`web-start`). `OSIRIS_DATA=<folder> scripts/web-smoke.sh` prints `osiris web: main menu`.
- **A bar while the files load, and a faster start.** While the folder is read the page draws a
  bar over the picture — `Reading game files: 412 / 1335 (31%)`, repainted at most every 100 ms —
  and reads eight files at a time rather than one, which on a full install took the read from
  about 4 seconds to about 2.7. Drag and drop and the copy in browser storage go through the
  same bar, and the log says how long the start took (`web-progress`).
  `OSIRIS_DATA=<folder> SMOKE_PICK=1 scripts/web-smoke.sh` prints
  `osiris web: loading bar OK (...)` and `osiris web: menu after N ms`, and saves the picture it
  took to `/tmp/osiris-web-loading.png`.
- **Your folder is remembered.** After the first load the page copies the game files into the
  browser's own storage (the Origin Private File System: about 780 MB for a full install, with
  PDFs, archives and installers left out) and writes a marker only once every file is there. On
  the next visit the game starts from that copy with no folder picker (`web-remember`).
  `OSIRIS_DATA=<folder> SMOKE_REMEMBER=1 scripts/web-smoke.sh` prints
  `osiris web: remember OK (N files)`.
- **Saves and settings stay across reloads.** They are kept in the browser's IndexedDB under
  `/user` (`web-persist`). `scripts/web-smoke.sh` prints `osiris web: persist OK`.
- **A save leaves the browser and comes back.** The Saves button lists every save under `/user`
  with its family, file name, size and date, downloads one as a file, deletes one after asking,
  and imports a file into the active family's saves folder (`web-saves-io`). A downloaded save is
  a desktop Osiris save, so the desktop build loads it, and the other way round.
  `OSIRIS_DATA=<folder> SMOKE_SAVES=1 scripts/web-smoke.sh` prints
  `osiris web: saves export/import OK`.
- **Drag the folder onto the page.** A folder dragged from the file manager is read the same way
  as one picked in the file dialog, and a folder that is not Pharaoh is refused with a message
  (`web-drop`). `scripts/web-smoke.sh` prints `osiris web: drop OK`.
- **Music, effects and speech.** The browser opens an audio device after the first click and
  plays the game's sounds (`web-sound`). `scripts/web-smoke.sh` prints
  `osiris web: sound OK`, and with game data `osiris web: game sound OK (running)`.
- **A mission starts and the city runs.** Either from `?mission=N` or from the main menu, the
  city screen draws and months pass (`web-mission`).
  `OSIRIS_DATA=<folder> SMOKE_MISSION=direct scripts/web-smoke.sh` prints
  `osiris web: city started and ran 2 months: 1, 2`, and
  `OSIRIS_DATA=<folder> SMOKE_MISSION=menu scripts/web-smoke.sh` prints
  `osiris web: the menu started a city that ran 2 months: 1, 2`.
- **The long run, the custom map and the Mission Editor.** The same city plays 24 game months at
  the fastest speed while the page logs its frame rate every ten seconds and its wasm memory every
  month, and a custom map from `Maps/` plays six; the Mission Editor opens `Small Oasis.map`, paints
  tiles, saves it under a new name in `/user/maps` and goes back to the menu (`web-soak`).
  `OSIRIS_DATA=<folder> SMOKE_SOAK=1 scripts/web-smoke.sh` prints
  `osiris web: soak OK (24 months, min fps 7, memory start 931 MB end 931 MB)`,
  `osiris web: custom map soak OK (6 months on Small Oasis, ...)` and
  `osiris web: editor OK (Small Oasis edited and saved as /user/maps/Soak Edit.map)`.
- **The movies play.** The intro and the periods' movies play in the page with their sound, and
  Escape skips one (`web-movies`).
  `OSIRIS_DATA=<folder> SMOKE_MOVIE=intro scripts/web-smoke.sh` prints
  `osiris web: the intro played, Escape skipped it, the menu is up (3 buttons)`.
- **The canvas fills the window.** The picture is the browser window's size at the screen's
  pixel ratio, and it follows the window, fullscreen and F11 (`web-fit`). Below 1024x768 the page
  keeps that floor, and a corner link brings the page back over the running game.
  `OSIRIS_DATA=<folder> SMOKE_MISSION=menu SMOKE_VIEWPORT=1920x1080 scripts/web-smoke.sh` prints
  `osiris web: viewport OK (1920x1080 then 1280x720)`.
- **The page is published.** `scripts/pages-site.sh` builds a static site in `out/site/` holding
  only the page and the wasm, and GitHub Pages serves it (`web-pages`). `sh scripts/pages-site.sh`
  prints `check-site: OK`, and `SMOKE_ROOT=$PWD/out/site SMOKE_BASE=/osiris/ node web/tests/smoke.mjs`
  prints `osiris web: base OK (/osiris/)`.

## 3. Missing or different from desktop

- Saves and settings live in the browser's storage, not in a folder you can open. A save moves
  in and out only through the Saves panel's Download and Import.
- The page has no command line. The only start option is `?mission=N`; `--data`, `--script` and
  `--screenshot` are desktop only, so the scripting and megacity tools do not apply.
- The copy of the game files is a second copy of your install, about 780 MB of it. The browser may
  throw it away when space runs low; the page then asks for your folder again. The "Forget game
  files" button at the bottom right deletes it and reloads.
- Sound starts after your first click, because the browser does not let a page play audio before
  that.
- No threads. Autosaves and movie decoding run on the same thread as the game, so a movie may
  play less smoothly than on the desktop.
- The browser build is the same game rules and the same graphics, but slower than the desktop
  build, because wasm runs single-threaded and the first load reads a 13 MB wasm file.

## 4. Checks

- `scripts/check.sh` runs the branch check, `scripts/no-game-files.sh`, `scripts/no-direct-fs.sh`,
  the `check-site.sh` self-test, `cargo test --workspace`, the wasm compile check and
  `scripts/openspec validate --all --strict`, and ends with `CHECK OK`.
- `scripts/web-smoke.sh` builds the page and runs the browser smoke test. Its modes are the
  environment variables `OSIRIS_DATA` (game files), `SMOKE_MISSION=direct|menu`, `SMOKE_MOVIE=intro`,
  `SMOKE_ROOT` and `SMOKE_BASE` (serve another copy of the page, for example `out/site` under
  `/osiris/`), `SMOKE_REMEMBER=1` (copy the files into browser storage, reload, and start with no
  picker), `SMOKE_SAVES=1` (start a city from the menu, save it, download it, delete it, import it
  again and load it from the game's own load screen), `SMOKE_PICK=1` (hand the staged folder to the page's own folder picker, so the page's
  reading path and the loading bar run; not with `SMOKE_REMEMBER`) and `SMOKE_TIMEOUT` (seconds,
  default 120). `SMOKE_WRAP=outer/inner` stages the game
  files two folders deeper and loads them through the page's own folder picker, as a GOG install
  sits; that run prints `osiris web: city started and ran 2 months: 1, 2`.
- `scripts/no-game-files.sh` prints `no-game-files: OK` when no Pharaoh file is tracked in git.
