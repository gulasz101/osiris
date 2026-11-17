# Tasks: web-movies

- [x] 1.1 Move `skip`, `fit`, `draw` and `clock` into one `impl Movie` with no `cfg` (design 2). Desktop behaviour must not change. Check: `cargo test -p osiris-app` passes and `cargo check --target wasm32-unknown-unknown -p osiris-app` exits 0.
- [x] 1.2 The wasm `Movie` struct, wasm `Movie::run`, and one `start`/`silent` body for both targets (design 2). Check: the wasm check exits 0, `cargo test -p osiris-app` passes, and `grep -n "not played in the browser" crates/osiris-app/src/movie.rs` prints nothing.
- [ ] 1.3 wasm `decode_some`, `update`, `seek_blocking` and the three log lines (design 1 and 2). Check: the wasm check exits 0 and `scripts/build-web.sh` succeeds.
- [ ] 1.4 The browser start path reaches `play_movie(movie::INTRO, ...)` (design 3). Check: `scripts/web-smoke.sh` with no `OSIRIS_DATA` still passes; paste the line of `web.rs`/`main.rs` that leads to the intro in the issue comment.
- [ ] 1.5 Smoke test `SMOKE_MOVIE=intro` and `scripts/web-smoke.sh` passes it through (design 4). Check: `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources SMOKE_MOVIE=intro scripts/web-smoke.sh` prints `osiris web: movie Intro_big frame 60`, `osiris web: movie Intro_big done` and `osiris web: page main`, and writes `/tmp/osiris-web-movie.png` over 50 000 bytes. Paste the three lines and the seconds from `started` to `frame 60`.
- [ ] 1.6 `SMOKE_MISSION=menu` presses Escape on the intro (design 4). Check: `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources SMOKE_MISSION=menu scripts/web-smoke.sh` passes, and so does `SMOKE_MISSION=direct`.
- [ ] 1.7 README: one line that movies play in the browser and Escape skips them. Check: `scripts/check.sh` ends with `CHECK OK` and `scripts/no-game-files.sh` prints OK.
