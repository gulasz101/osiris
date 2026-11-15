# web-vfs-main: main.rs uses osiris-vfs, and the browser has a user folder

## Why
`crates/osiris-app/src/main.rs` holds the last 45 direct file calls (saves, families, campaign
progress, settings, autosaves, the log). After this change nothing in the browser build touches
`std::fs`, so the next change can load the game from memory.

## What changes
- Every `std::fs` / `Path::is_dir|is_file|exists` / `metadata` call in non-test code of
  `main.rs` goes through `osiris_vfs`.
- `user_dir()` returns `/user` in the browser (in memory for now; a later change keeps it across
  page loads). Desktop is unchanged.
- The Windows log file (`init_logging`) is compiled only on Windows.
- `scripts/check.sh` gets one more step: `scripts/no-direct-fs.sh` (all crates) must print OK.
