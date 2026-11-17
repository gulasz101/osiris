# Tasks: web-mission

- [x] 1.1 `start_game(mission: Option<u32>)` and `?mission=N` in `main.js` (design 1). Check: `scripts/build-web.sh` succeeds and `scripts/web-smoke.sh` (no `OSIRIS_DATA`) passes.
- [x] 1.2 Log lines `city <m> started`, `city month <n>`, `page <name>` (design 2). Check: `cargo check -p osiris-app` and the wasm check exit 0; `cargo test -p osiris-app` passes.
- [x] 1.3 Smoke test `SMOKE_MISSION=direct` (design 4). Check: `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources SMOKE_MISSION=direct scripts/web-smoke.sh` prints two `osiris web: city month` lines and writes `/tmp/osiris-web-city.png` over 50 000 bytes. Paste the two lines in the issue comment.
- [x] 1.4 `debug_menu_buttons()` (design 3). Check: wasm check exits 0; with game data, a one-off `page.evaluate` in the smoke test prints a non-empty list on `page family` (paste 2 entries in the comment).
- [x] 1.5 Smoke test `SMOKE_MISSION=menu` (design 4). Check: the same command with `SMOKE_MISSION=menu` prints `osiris web: page briefing`, `osiris web: city ... started` and two month lines, and writes the screenshot.
- [x] 1.6 README: one line on `?mission=N`. Check: `scripts/check.sh` ends with `CHECK OK` and `scripts/no-game-files.sh` prints OK.
