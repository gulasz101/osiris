# web-time-threads: no clock or thread call that panics in the browser

## Why
On `wasm32-unknown-unknown`, `std::time::Instant::now()`, `std::time::SystemTime::now()` and
`std::thread::spawn` compile but panic when called. The game calls all three on its normal path
(frame timing, autosave, movies), so the browser build would crash on the first frame.

## What changes
- `std::time::Instant` and `SystemTime` become `web_time::Instant` / `web_time::SystemTime` in
  non-test code. On desktop `web-time` is the std type itself, so desktop behaviour is the same.
- The autosave writes on the calling thread in the browser (desktop keeps its thread).
- Movies are skipped in the browser for now (desktop unchanged). A later change brings them back.

## Out of scope
Files (`std::fs`) are the `web-vfs` change. Sound is a later change.
