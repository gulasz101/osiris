# web-status: docs/STATUS.md tells Wojtek what the browser build can do

## Why
Wojtek asked for one page that says, in plain English, what Osiris Web does today, how to run
it, and what is still missing. Today that knowledge is spread over archived OpenSpec changes.

## What changes
- New file `docs/STATUS.md` (B2 English, short sentences, no marketing), with these sections:
  1. **Run it**: the exact commands to build and open the page (`scripts/build-web.sh`, how to serve
     `web/`, the URL), and where the player's own game data comes from (drag and drop a folder, as in
     web-drop). Say plainly that the page ships no game data.
  2. **Works**: one line per feature, each naming the archived change and the smoke command that
     proves it (vfs, start, time-threads, persist, drop, sound, pages, mission, movies).
  3. **Missing or different from desktop**: one line each, honest.
  4. **Checks**: `scripts/check.sh`, `scripts/web-smoke.sh` with its `SMOKE_*` modes, `scripts/no-game-files.sh`.
- `README.md`: one line linking to `docs/STATUS.md`.

## Out of scope
Code changes. If writing the page shows a bug, file it on the issue; do not fix it in this change.
