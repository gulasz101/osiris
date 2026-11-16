# web-sound: music, effects and speech play in the browser

## Why
In the browser build the game is silent. Two things cause it. `rodio` is built without cpal's
`wasm-bindgen` feature, so cpal has no output device on `wasm32-unknown-unknown` and
`Audio::new` quietly returns a mute `Audio`. And `osiris-audio` opens every sound file with
`std::fs::File`, which cannot read the in-memory store (`osiris-vfs`), so even with a device no
file would load. Browsers also keep an `AudioContext` suspended until the page has seen a user
gesture.

## What changes
- `crates/osiris-audio/Cargo.toml`: on `wasm32` build `rodio` with feature `wasm-bindgen`
  (this turns on `cpal/wasm-bindgen`, the WebAudio backend). Desktop dependencies stay as they are.
- `crates/osiris-audio/src/lib.rs`: `open_source` and `open_looped_source` read through
  `osiris_vfs::open` / `osiris_vfs::len` instead of `std::fs::File`, so the same code works on
  desktop and in the browser. `scripts/no-direct-fs.sh` then reports nothing for this crate.
- `web/audio.js` (new, classic script before `main.js`): wraps `window.AudioContext` to remember
  every context the game creates, and resumes suspended ones on the next click, key press or
  touch. `osirisAudio.state()` reports `running`, `suspended` or `none`.
- `src/web.rs` (crate osiris-app): two exports for the smoke test, `debug_audio_open()` and
  `debug_audio_beep()`.
- Smoke test: after a click, the audio context is `running` and a generated WAV played from the
  in-memory store.

## Out of scope
Movie sound (movies are not played in the browser yet, see `movie.rs`), running the mixer in an
AudioWorklet (cpal feature `audioworklet`, needs threads and special headers), volume UI changes,
any change to which sound plays when.
