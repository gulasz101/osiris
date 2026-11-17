#!/bin/sh
# Build the wasm page and copy only the page files into out/site, the folder we
# publish on GitHub Pages. check-site.sh stops the run if anything else, or any
# game file, lands in there.
# Usage: sh scripts/pages-site.sh
set -eu
cd "$(dirname "$0")/.."
sh scripts/build-web.sh
rm -rf out/site && mkdir -p out/site/pkg
cp web/index.html web/main.js web/folder.js web/store.js web/audio.js web/opfs.js out/site/
cp web/pkg/osiris.js web/pkg/osiris_bg.wasm out/site/pkg/
: > out/site/.nojekyll
sh scripts/check-site.sh out/site
