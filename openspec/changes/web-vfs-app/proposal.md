# web-vfs-app: osiris-app files (except main.rs) use osiris-vfs

## Why
Same reason as `web-vfs-core`: no `std::fs` in the browser. This change moves the 30 calls in
`crates/osiris-app/src` outside `main.rs` (settings, language files, editor, movies, scripts,
screenshots). `main.rs` is the next change, `web-vfs-main`.

## What changes
`osiris-app` depends on `osiris-vfs` and every call in these files goes through it:
`data_dir.rs`, `editor/kingdom.rs`, `editor/mod.rs`, `editor/script.rs`, `game.rs`, `gfx.rs`,
`lang.rs`, `menu.rs`, `movie.rs`, `script.rs`, `sound_options.rs`.

After it, `scripts/no-direct-fs.sh crates/osiris-app/src` lists `main.rs` lines only.
