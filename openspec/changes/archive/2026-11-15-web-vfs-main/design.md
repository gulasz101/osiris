# Design: web-vfs-main

Replacement rules: as in `web-vfs-app/design.md` (or `openspec/changes/archive/*web-vfs-app*`).

Lines listed on 2026-11-15 by `scripts/no-direct-fs.sh crates/osiris-app/src/main.rs`:
126 166 172 195 201 207 211 215 232 242 266 311 320 321 331 332 339 348 349 354 355 366 367 370
376 377 378 379 382 383 387 412 419 420 488 528 1062 1076 1159 1162 1164 1193 1194 1205 1881.
They move as you edit; run the script again after each block.

## user_dir (~line 116)
Keep the desktop function and gate it `#[cfg(not(target_arch = "wasm32"))]`. Add:

```rust
/// In the browser saves and settings live in memory under /user (kept across page loads by a
/// later change).
#[cfg(target_arch = "wasm32")]
fn user_dir() -> PathBuf {
    PathBuf::from("/user")
}
```

## init_logging (~line 1878)
`let to_file = cfg!(windows) && !headless;` stays. Wrap only the `File::create(log_path())` block
in `#[cfg(windows)] { ... }` so the browser build has no `std::fs::File`. The browser gets its
console logger in the `web-page` change.

## Gate step
Add to `scripts/check.sh`, after the game-files step: `scripts/no-direct-fs.sh` (no arguments).
