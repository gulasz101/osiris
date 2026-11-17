# web-movies: the original's Bink movies play in the browser

## Why
On the desktop the intro and the five period movies play (`crates/osiris-app/src/movie.rs`).
In the browser `movie::start` and `movie::silent` return `None` (web-time-threads skipped them,
because the desktop player decodes on its own thread and `std::thread::spawn` panics in wasm).
The browser game is not the full game until they play there too.

## What changes
- `crates/osiris-app/src/movie.rs`: a wasm `Movie` that decodes on the main thread, inside
  `update()`, only the frames that are due. Same clock rule as the desktop: the sound's
  position when it is heard, otherwise the time since the movie started.
- Movie sound in the browser through `osiris_audio::StreamSound`, as on the desktop.
- Browser-only log lines the smoke test waits for: `osiris web: movie <name> started`,
  `osiris web: movie <name> frame <n>` every 30 frames, `osiris web: movie <name> done`.
- `web/tests/smoke.mjs`: `SMOKE_MOVIE=intro` (with `OSIRIS_DATA`) waits for frame 60 of
  `Intro_big`, saves `/tmp/osiris-web-movie.png`, presses Escape and waits for
  `osiris web: page main`. The `SMOKE_MISSION=menu` path skips the intro with Escape.

## Out of scope
Smacker (`.smk`) files, movie quality settings, a worker thread for decoding, the desktop player
(it stays as it is).
