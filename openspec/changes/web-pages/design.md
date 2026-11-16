# Design: web-pages

Look up first, in docs-mcp: `github-pages-actions` (page "Using custom workflows with GitHub
Pages": `upload-pages-artifact`, `deploy-pages`, permissions, the `github-pages` environment),
`wasm-bindgen` (CLI version must equal the crate version). The action source is the ground
truth for inputs: `https://github.com/actions/upload-pages-artifact/blob/main/action.yml`.

## Facts checked
- The repo is public, so GitHub Pages is free for it. Pages is not on yet
  (`gh api repos/gulasz101/osiris/pages` returns 404). The default `GITHUB_TOKEN` cannot turn it
  on; Wojtek sets Settings, Pages, Source "GitHub Actions" once. Until then the deploy job fails
  with "Not Found"; the build job and `check-site.sh` still run and must pass.
- `deploy-pages` needs `pages: write` and `id-token: write`, the environment `github-pages`, and
  `needs:` on the build job. `upload-pages-artifact` takes `path` (required), archives the folder
  with `tar --dereference` and leaves out dot files unless `include-hidden-files: true`. We need
  that flag for `.nojekyll`. Current tags: `upload-pages-artifact@v5`, `deploy-pages@v5`.
- The site is served under `/osiris/`. Every URL in the page is relative already:
  `index.html` loads `store.js`, `audio.js`, `main.js` without a leading `/`; `main.js` imports
  `./folder.js` and `./pkg/osiris.js`; wasm-bindgen's `--target web` loader finds
  `osiris_bg.wasm` with `new URL('osiris_bg.wasm', import.meta.url)`. The `"/" + entry.path` in
  `main.js` is a path inside the in-memory store, not a URL. So no page code changes are needed;
  the smoke test under `SMOKE_BASE=/osiris/` proves it.
- `Cargo.lock` pins `wasm-bindgen` 0.2.128. The CLI must be the same version or the generated
  JS does not match the module. In CI: read the version from `Cargo.lock` and run
  `cargo install wasm-bindgen-cli --version "$V" --locked` (cache it with
  `Swatinem/rust-cache@v2` like `build.yml`).
- `osiris_bg.wasm` is about 13 MB. Pages allows 1 GB per site and 100 MB per file; the 50 MB cap
  in `check-site.sh` is our own early warning.
- No threads: the web build uses no `SharedArrayBuffer`, so the page needs no COOP/COEP headers.

## scripts/pages-site.sh
```sh
#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
sh scripts/build-web.sh
rm -rf out/site && mkdir -p out/site/pkg
cp web/index.html web/main.js web/folder.js web/store.js web/audio.js out/site/
cp web/pkg/osiris.js web/pkg/osiris_bg.wasm out/site/pkg/
: > out/site/.nojekyll
sh scripts/check-site.sh out/site
```
`out/` is already in `.gitignore`.

## scripts/check-site.sh DIR
POSIX sh. Lists every file under DIR (`find DIR -type f`, paths relative to DIR) and fails
(exit 1, one line per problem, then `check-site: FAILED`) when:
- a file is not one of: `.nojekyll`, `index.html`, `main.js`, `folder.js`, `store.js`,
  `audio.js`, `pkg/osiris.js`, `pkg/osiris_bg.wasm`;
- a path matches, ignoring case, `\.(sg2|sg3|555|map|sav|pak|bik|smk|wav|mp3|exe|zip)$`,
  `game-data-staging` or `PharaohData`;
- a file is larger than 50 MB (`wc -c`).
Prints `check-site: OK` otherwise. A test in `scripts/check.sh`: run it on a temp folder with a
fake `Data/test.sg3` and expect exit 1, then on `out/site` if it exists.

## web/tests/smoke.mjs
```js
const WEB_DIR = path.resolve(process.env.SMOKE_ROOT ?? path.resolve(import.meta.dirname, ".."));
const BASE = process.env.SMOKE_BASE ?? "/";   // must start and end with "/"
```
The handler strips `BASE` from `url.pathname` (404 when the path does not start with it), maps
`""` to `index.html`, and refuses paths that leave `WEB_DIR` (`..`). `page.goto` opens
`http://localhost:${PORT}${BASE}`. Tests that stage game data under `WEB_DIR` keep working only
when `SMOKE_ROOT` is unset; when it is set, skip those staged-data checks with
`SKIP: game data needs SMOKE_ROOT unset`.

## .github/workflows/pages.yml
```yaml
name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@v2
      - name: wasm-bindgen CLI (same version as Cargo.lock)
        run: |
          V=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | sed -n 's/^version = "\(.*\)"/\1/p')
          cargo install wasm-bindgen-cli --version "$V" --locked
      - run: sh scripts/pages-site.sh
      - uses: actions/upload-pages-artifact@v5
        with:
          path: out/site
          include-hidden-files: true
  deploy:
    needs: build
    runs-on: ubuntu-22.04
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```
`pages-site.sh` already runs `check-site.sh`, so a game file or a stray file stops the run
before the upload.
