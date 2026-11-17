#!/bin/sh
# Build the wasm page and copy only the page files into out/site, the folder we
# publish on GitHub Pages: the page and every script next to it, so a new script
# cannot be left behind the way files.js was. check-site.sh stops the run if
# anything else, or any game file, lands in there.
# Usage: sh scripts/pages-site.sh
set -eu
cd "$(dirname "$0")/.."
sh scripts/build-web.sh
rm -rf out/site && mkdir -p out/site/pkg out/site/assets
cp web/index.html out/site/
cp web/*.js out/site/
cp web/assets/*.jpg out/site/assets/
cp web/pkg/osiris.js web/pkg/osiris_bg.wasm web/pkg/osiris_size.json out/site/pkg/
: > out/site/.nojekyll
sh scripts/check-site.sh out/site
