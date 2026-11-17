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
- **Saves and settings stay across reloads.** They are kept in the browser's IndexedDB under
  `/user` (`web-persist`). `scripts/web-smoke.sh` prints `osiris web: persist OK`.
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
- **The movies play.** The intro and the periods' movies play in the page with their sound, and
  Escape skips one (`web-movies`).
  `OSIRIS_DATA=<folder> SMOKE_MOVIE=intro scripts/web-smoke.sh` prints
  `osiris web: the intro played, Escape skipped it, the menu is up (3 buttons)`.
- **The page is published.** `scripts/pages-site.sh` builds a static site in `out/site/` holding
  only the page and the wasm, and GitHub Pages serves it (`web-pages`). `sh scripts/pages-site.sh`
  prints `check-site: OK`, and `SMOKE_ROOT=$PWD/out/site SMOKE_BASE=/osiris/ node web/tests/smoke.mjs`
  prints `osiris web: base OK (/osiris/)`.

## 3. Missing or different from desktop

- You choose your Pharaoh folder again after every page reload. The game files are read into
  memory and not stored, only your saves and settings are.
- Saves and settings live in the browser's storage, not in a folder you can open. Copying a save
  to another computer or to the desktop build is not possible yet.
- The page has no command line. The only start option is `?mission=N`; `--data`, `--script` and
  `--screenshot` are desktop only, so the scripting and megacity tools do not apply.
- Sound starts after your first click, because the browser does not let a page play audio before
  that.
- No threads. Autosaves and movie decoding run on the same thread as the game, so a movie may
  play less smoothly than on the desktop.
- The Mission Editor and custom maps reachable from the menu have not been tried in the browser
  yet, so treat them as untested rather than working.
- The browser build is the same game rules and the same graphics, but slower than the desktop
  build, because wasm runs single-threaded and the first load reads a 13 MB wasm file.

## 4. Checks

- `scripts/check.sh` runs the branch check, `scripts/no-game-files.sh`, `scripts/no-direct-fs.sh`,
  the `check-site.sh` self-test, `cargo test --workspace`, the wasm compile check and
  `scripts/openspec validate --all --strict`, and ends with `CHECK OK`.
- `scripts/web-smoke.sh` builds the page and runs the browser smoke test. Its modes are the
  environment variables `OSIRIS_DATA` (game files), `SMOKE_MISSION=direct|menu`, `SMOKE_MOVIE=intro`,
  `SMOKE_ROOT` and `SMOKE_BASE` (serve another copy of the page, for example `out/site` under
  `/osiris/`), and `SMOKE_TIMEOUT` (seconds, default 120). `SMOKE_WRAP=outer/inner` stages the game
  files two folders deeper and loads them through the page's own folder picker, as a GOG install
  sits; that run prints `osiris web: city started and ran 2 months: 1, 2`.
- `scripts/no-game-files.sh` prints `no-game-files: OK` when no Pharaoh file is tracked in git.
