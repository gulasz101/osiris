# Design: web-movies

Look up first, in docs-mcp, then Firecrawl if missing: `rust-std` (`std::collections::VecDeque`:
`push_back`, `pop_front`, `front`), `rodio` (playing a streamed source in the browser, the
`wasm-bindgen` feature), `playwright` (`page.keyboard.press`, `page.screenshot`,
`page.waitForEvent("console")`). Write in the issue comment which pages you read.

Game data for the tests: `/Users/paperclip/PharaohData/Akhenaten/resources`, read only. Never copy
it into the repo; `web/game-data-staging` is git-ignored and `scripts/no-game-files.sh` must pass.

The desktop player does not change. Every new item below is `#[cfg(target_arch = "wasm32")]`,
except the functions moved into the shared `impl Movie` in part 2.

## 1. Why the decoder cannot just follow the clock
The clock is the sound's position when sound plays. Sound samples come out of the decoder (one
batch per frame). If the browser decoded only the frames that are due, the sound would run dry,
its position would stop, no frame would be due, and the movie would hang. So the browser keeps
what the desktop thread does: it decodes up to `AHEAD` (6) frames ahead of the one on screen.
The only difference is where: in `update()`, on the main thread, a few frames per call.

## 2. The wasm `Movie` (src/movie.rs)
Replace the wasm stub struct with:
```rust
#[cfg(target_arch = "wasm32")]
pub struct Movie {
    name: String,
    width: u32,
    height: u32,
    fps: f64,
    frames: usize,
    bink: osiris_bink::Movie<osiris_vfs::Reader>,
    feed: Option<osiris_audio::StreamFeed>,
    /// Decoded frames not yet due, oldest first; at most AHEAD.
    queue: std::collections::VecDeque<(usize, Vec<u8>)>,
    shown: Option<usize>,
    picture: Vec<u8>,
    dirty: bool,
    handle: Option<DynamicHandle>,
    decoded_all: bool,
    sound: Option<StreamSound>,
    start: Instant,
    pub done: bool,
}
```
- `start` and `silent`: one body for both targets. Remove the wasm stubs and the
  `#[cfg(not(target_arch = "wasm32"))]` on the real ones, and on the `StreamSound` import.
  `Movie::run` stays desktop only; add a wasm `Movie::run` with the same signature that fills the
  struct above (`feed = sound.as_ref().map(|s| s.feed())`) and logs
  `osiris web: movie <name> started`.
- New wasm `fn decode_some(&mut self)`: at most `PER_UPDATE` (const, 2) times, while
  `queue.len() < AHEAD` and not `decoded_all`: take the body of the desktop thread's loop
  (`next_frame` into a samples `Vec`, `feed.push`, `to_rgba`) and `push_back` the frame. On
  `Ok(false)` or `Err` set `decoded_all` (log the error with `log::warn!` as the desktop does) and
  call `feed.finish()`. Every 30th frame index (30, 60, ...) log `osiris web: movie <name> frame <n>`.
- wasm `update()`: `decode_some()`, then the same rule as the desktop `advance_to(clock())`, but
  reading `queue.front()` / `pop_front()` instead of `rx.try_recv()`. When `done` turns true, log
  `osiris web: movie <name> done` once.
- wasm `seek_blocking(seconds)`: loop `decode_some()` and take frames until `shown >= target` or
  `decoded_all`.
- `skip`, `fit`, `draw` and `clock` use only fields both structs have: move them out of the
  desktop-only `impl` into one `impl Movie` with no `cfg`. `skip` only sets `done`; dropping the
  `Movie` drops `sound`, which stops it, as on the desktop. On wasm, log
  `osiris web: movie <name> done` from one place (`fn log_done(&mut self)` with a `logged_done:
  bool` field), called from both `update()` and `skip()`.

## 3. Where movies start in the browser
`play_movie` in `main.rs` already decides (`self.sound.movies && !direct`). Nothing changes there:
with `?mission=N` the run is direct and skips movies; with no query the intro plays before the
main menu (main.rs, `self.play_movie(movie::INTRO, Screen::Menu(menu))`). Check that the web
start path (`src/web.rs` `start_game` with no mission) reaches that line; if it builds the menu
another way, make it call `play_movie(movie::INTRO, ...)` the same way.

## 4. Smoke test (web/tests/smoke.mjs, scripts/web-smoke.sh)
- New env `SMOKE_MOVIE` (empty or `intro`; anything else fails, like `SMOKE_MISSION`). With
  `intro` and `OSIRIS_DATA`: open the page with no query, choose the folder as the other modes do,
  wait (90 s limit) for `osiris web: movie Intro_big frame 60`, save `/tmp/osiris-web-movie.png`,
  press Escape, wait for `osiris web: movie Intro_big done` and then `osiris web: page main`.
  Fail on a panic line. Without `OSIRIS_DATA`: print `SKIP: no game data` and exit 0.
- `SMOKE_MISSION=menu` now meets the intro first: when it sees `osiris web: movie Intro_big
  started`, press Escape, then go on as before.
- `scripts/web-smoke.sh` passes `SMOKE_MOVIE` through as it does `SMOKE_MISSION`.

## 5. Risks
- Speed: a release wasm build must decode 2 frames per browser frame without dropping below
  30 fps. If the smoke test shows `frame 60` later than 10 s after `started`, write the timing in
  the issue comment; do not add a worker thread in this change.
- Memory: `AHEAD` frames of RGBA at the movie's size (about 1.9 MB each at 800x600), same as the
  desktop.
