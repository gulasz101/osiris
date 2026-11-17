# web-pages Specification

## Purpose
Publish the browser build as a static site on GitHub Pages from `main`, with the same page files and no Pharaoh game data, so anyone can open the page and load their own game folder.

## Requirements

### Requirement: The page is published with no game data
The repo SHALL build a static site in `out/site/` holding only the page files and publish it on
GitHub Pages from `main`. The site SHALL NOT contain any Pharaoh game file.

#### Scenario: site holds only page files
- GIVEN `scripts/pages-site.sh` has run
- WHEN `scripts/check-site.sh out/site` runs
- THEN it prints `check-site: OK`
- AND `out/site` holds only `.nojekyll`, `index.html`, `main.js`, `folder.js`, `store.js`, `audio.js`, `pkg/osiris.js` and `pkg/osiris_bg.wasm`

#### Scenario: a game file stops the publish
- GIVEN a site folder that holds `Data/test.sg3`
- WHEN `scripts/check-site.sh` runs on it
- THEN it prints `check-site: FAILED` and exits 1
- AND the pages workflow uploads nothing

### Requirement: The page works under the Pages path
The published page SHALL load from the sub-path `/osiris/` with relative URLs only.

#### Scenario: smoke test under /osiris/
- GIVEN `out/site/` built by `scripts/pages-site.sh`
- WHEN the smoke test serves it with `SMOKE_BASE=/osiris/` and opens it in headless Chromium
- THEN the console shows `osiris web: ready`
- AND no request returns 404
