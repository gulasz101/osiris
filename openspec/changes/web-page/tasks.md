# Tasks: web-page

- [x] 1.1 Add the wasm dependencies and `src/web.rs` with `init()`; add the browser `main` (design.md). Check: wasm check exits 0, `Cargo.lock` still has wasm-bindgen 0.2.128, `cargo test -p osiris-app` passes.
- [ ] 1.2 Write `scripts/build-web.sh` and the `.gitignore` lines. Check: `scripts/build-web.sh` (bash `timeout: 1800`) ends by listing `web/pkg/osiris.js` and `web/pkg/osiris_bg.wasm`.
- [ ] 1.3 Write `web/index.html` and `web/main.js`. Check: `git status` shows no file under `web/pkg/`.
- [ ] 1.4 Write `web/tests/package.json`, `web/tests/smoke.mjs`, `scripts/web-smoke.sh`. Check: `scripts/web-smoke.sh` exits 0 and its output contains `osiris web: ready`.
- [ ] 1.5 `scripts/check.sh` ends with `CHECK OK`; paste the last 15 lines of `scripts/web-smoke.sh` in the issue comment.
