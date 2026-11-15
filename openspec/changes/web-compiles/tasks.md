# Tasks: web-compiles

## 1. Compile for wasm
- [x] 1.1 Add the two `getrandom` wasm dependencies to `crates/osiris-app/Cargo.toml` and the `[target.wasm32-unknown-unknown]` rustflags to `.cargo/config.toml` (see design.md). Check: `cargo check --target wasm32-unknown-unknown -p osiris-app` no longer mentions getrandom (the only error left is `FileDialog`).
- [x] 1.2 Gate `data_dir::pick` as in design.md. Check: `cargo check --target wasm32-unknown-unknown -p osiris-app` exits 0, and `cargo check -p osiris-app` (desktop) exits 0.

## 2. The gate
- [ ] 2.1 Write `scripts/no-game-files.sh` (executable). Check: it exits 0 on the repo; `touch x.sg3 && git add x.sg3 && scripts/no-game-files.sh` exits 1; then `git rm --cached -q x.sg3 && rm x.sg3`.
- [ ] 2.2 Write `scripts/check.sh` (executable) with the six steps from design.md. Check: `scripts/check.sh` ends with `CHECK OK` (give the bash call `timeout: 1800`).
