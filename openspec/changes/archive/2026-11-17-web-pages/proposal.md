# web-pages: publish the browser page on GitHub Pages, with no game data

## Why
The page runs only from a local checkout today (`scripts/build-web.sh`, then a local server).
A player should be able to open one URL, choose their own Pharaoh folder and play. GitHub Pages
can serve the static page (`index.html`, the four scripts and `pkg/`) for this public repo at
`https://gulasz101.github.io/osiris/`. The page already reads the player's files in the browser
and uploads nothing, so the site holds only our code.

## What changes
- `scripts/pages-site.sh` (new): builds the wasm (`scripts/build-web.sh`) and copies only the
  page files into `out/site/`: `index.html`, `main.js`, `folder.js`, `store.js`, `audio.js`,
  `pkg/osiris.js`, `pkg/osiris_bg.wasm`, plus an empty `.nojekyll`. Nothing else from `web/`.
- `scripts/check-site.sh DIR` (new): fails when DIR holds any file not on that list, any game file
  (same extensions as `scripts/no-game-files.sh`), or any file over 50 MB.
- `web/tests/smoke.mjs`: two optional env vars, `SMOKE_ROOT` (folder to serve, default `web/`)
  and `SMOKE_BASE` (URL prefix, default `/`), so the smoke test can load `out/site/` under
  `/osiris/`, the same path layout GitHub Pages uses.
- `.github/workflows/pages.yml` (new): on push to `main` and on manual run, build the site on
  `ubuntu-22.04`, run `scripts/check-site.sh out/site`, upload it with
  `actions/upload-pages-artifact@v5`, deploy with `actions/deploy-pages@v5`.
- `README.md`: one short section "Play in the browser" with the URL and the line that the game
  files stay on the player's computer.

## Out of scope
Any game data on the site (never), a custom domain, caching headers or a service worker,
threads (they would need COOP/COEP headers, which GitHub Pages cannot set), turning Pages on in
the repo settings (Wojtek does that once: Settings, Pages, Source "GitHub Actions").
