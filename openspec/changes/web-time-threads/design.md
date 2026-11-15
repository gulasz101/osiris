# Design: web-time-threads

## web-time 1.1.0 (already in Cargo.lock)
docs-mcp library `web-time`: on native targets `web_time::Instant` is `std::time::Instant`
re-exported; on wasm it uses `Performance.now()`. Same API. `Duration` stays `std::time::Duration`.

Add `web-time = "1.1"` to `[dependencies]` of `crates/osiris-app` and `crates/osiris-ui`.

## The call sites (found on 2026-11-15, non-test code only)
- `crates/osiris-ui/src/dialog.rs:17` `use std::time::{Duration, Instant};`
  -> `use std::time::Duration; use web_time::Instant;`
- `crates/osiris-app/src/movie.rs:11` same pattern.
- `crates/osiris-app/src/main.rs`: lines ~583, ~589, ~1140, ~1143, ~1587, ~2253 use
  `std::time::Instant` -> `web_time::Instant`.
- `crates/osiris-app/src/gfx.rs`: `std::time::Instant` (~257-272) -> `web_time::Instant`.
- `crates/osiris-app/src/game.rs:~618` and `src/script.rs:~163-166` -> `web_time::Instant`.
- `crates/osiris-app/src/city_sounds.rs:41` `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)`
  -> `web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH)`.
- Leave `#[cfg(test)]` modules, `examples/`, `osiris-tools` and `osiris-sim` tests alone.

Find any others with:
`grep -rnE 'std::time::(Instant|SystemTime)|use std::time::\{[^}]*Instant' crates/osiris-app/src crates/osiris-ui/src crates/osiris-render/src`

## Autosave (crates/osiris-app/src/main.rs, fn autosave, ~line 1158)
Move the body of the `std::thread::spawn(move || { ... })` closure into a new function:

```rust
/// Writes an autosave: to a temporary file first, then rotated into place.
fn write_autosave(saves: &Path, name: &str, bytes: Vec<u8>) { /* the old closure body */ }
```

Then:

```rust
#[cfg(not(target_arch = "wasm32"))]
std::thread::spawn(move || write_autosave(&saves, &name, bytes));
// The browser has no threads; the write is a copy into memory there, so it is quick.
#[cfg(target_arch = "wasm32")]
write_autosave(&saves, &name, bytes);
```

## Movies (crates/osiris-app/src/movie.rs)
Find the public function that opens a movie and returns `Option<Movie>` (it calls
`Movie::run`). On wasm make it return `None` before opening anything, with
`log::info!("movies are not played in the browser yet: {name}")`. Gate `fn run` (which spawns the
decoder thread) with `#[cfg(not(target_arch = "wasm32"))]`, plus whatever becomes unused on wasm.
Check the callers already handle `None` (a missing movie file gives `None` today).
