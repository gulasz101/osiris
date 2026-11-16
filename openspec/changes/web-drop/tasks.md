# Tasks: web-drop

- [x] 1.1 `web/folder.js` with `filesFromInput`, `filesFromDrop`, `walk` (design.md). Check: `scripts/build-web.sh` succeeds.
- [x] 1.2 `main.js`: `loadFolder(list)`, the input uses `filesFromInput`. Check: `scripts/web-smoke.sh` passes as before (and with `OSIRIS_DATA` still prints `osiris web: main menu`, if game data is on the host).
- [x] 1.3 Drop zone in `index.html` and `main.js` (`dragover`, `dragleave`, `drop`, `busy`). Check: `scripts/build-web.sh` succeeds.
- [x] 1.4 Smoke test walker and synthetic drop (design.md). Check: `scripts/web-smoke.sh` prints `osiris web: drop OK` and exits 0.
- [ ] 1.5 `scripts/check.sh` ends with `CHECK OK`.
