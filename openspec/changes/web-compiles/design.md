# Design: web-compiles

## getrandom
Two versions are in `Cargo.lock`: 0.3.4 and 0.4.3. Both need the `wasm_js` feature on wasm.
getrandom 0.3 also needs the cfg flag `getrandom_backend="wasm_js"`; check docs-mcp
(`getrandom` 0.3.4, section "WebAssembly support") and whether 0.4.3 still needs it.

Add to `crates/osiris-app/Cargo.toml` (renamed packages, so both versions can be listed):

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom_03 = { package = "getrandom", version = "0.3", features = ["wasm_js"] }
getrandom_04 = { package = "getrandom", version = "0.4", features = ["wasm_js"] }
```

Add to the existing `.cargo/config.toml` (keep the Windows block that is already there):

```toml
[target.wasm32-unknown-unknown]
rustflags = ["--cfg", 'getrandom_backend="wasm_js"']
```

If cargo warns "unused dependency" for one of the two, that is fine (they are only there to turn
the feature on).

## Folder picker
In `crates/osiris-app/src/data_dir.rs`, `pub fn pick(user_dir: &Path) -> Option<PathBuf>` uses
`rfd::FileDialog`. Put `#[cfg(not(target_arch = "wasm32"))]` on the existing function and add:

```rust
/// In the browser the page hands the game folder over itself (see the `web-page` change).
#[cfg(target_arch = "wasm32")]
pub fn pick(_user_dir: &Path) -> Option<PathBuf> {
    None
}
```

If this makes other items in the file unused on wasm only, gate those items the same way rather
than adding `#[allow(dead_code)]`.

## scripts/no-game-files.sh
`git ls-files` piped through a case-insensitive extension match. Fail (exit 1, print the files)
on: `sg2 sg3 555 map sav pak bik smk wav mp3 eng cmp`, and on names starting `pharaoh_text` or
`pharaoh_mm`. Today the repo has none (checked: `git ls-files` gives no match).

## scripts/check.sh
`#!/bin/sh`, `set -eu`, `cd` to the repo root, each step prints a `== name` line:
1. branch: `git rev-parse --abbrev-ref HEAD` must print `main`, else fail with
   "work on main only (AGENTS.md)".
2. `scripts/no-game-files.sh`
3. `cargo test --workspace --quiet`
4. `cargo check --target wasm32-unknown-unknown -p osiris-app`
5. `scripts/openspec validate --all --strict`
6. `echo CHECK OK`
