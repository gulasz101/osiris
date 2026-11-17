#!/bin/sh
# Check the folder we publish on GitHub Pages: only our own page files, never a
# game file, never anything huge.
# Usage: scripts/check-site.sh DIR
# Prints one line per problem, then "check-site: FAILED" and exits 1. Otherwise
# prints "check-site: OK" and exits 0.
set -eu

if [ $# -ne 1 ]; then
  echo "usage: scripts/check-site.sh DIR" >&2
  exit 2
fi

dir=$1
if [ ! -d "$dir" ]; then
  echo "check-site: $dir is not a folder"
  echo "check-site: FAILED"
  exit 1
fi

# The only files the site may hold: the page, a script next to it, the wasm build
# and an empty .nojekyll so GitHub Pages serves the files verbatim. Any *.js in
# the top folder is a page script, because pages-site.sh copies web/*.js.
allowed="
.nojekyll
index.html
pkg/osiris.js
pkg/osiris_bg.wasm
"

# Same idea as scripts/no-game-files.sh, plus the staging folders.
game_pattern='\.(sg2|sg3|555|map|sav|pak|bik|smk|wav|mp3|exe|zip)$'
big_limit=52428800 # 50 MB, our own early warning; Pages allows 100 MB per file

list=$(mktemp "${TMPDIR:-/tmp}/check-site.XXXXXX")
imports=$(mktemp "${TMPDIR:-/tmp}/check-site-imports.XXXXXX")
trap 'rm -f "$list" "$imports"' EXIT

# Paths relative to DIR, so the folder itself never shows up.
find "$dir" -type f | sed "s|^$dir/||" | sort > "$list"

failed=0
while IFS= read -r rel; do
    [ -n "$rel" ] || continue

    # The page's own artwork (the title and loading screens) sits in assets/ as JPEG.
    if ! printf '%s\n' "$allowed" | grep -qxF "$rel" &&
        ! printf '%s\n' "$rel" | grep -qxE '[A-Za-z0-9._-]+\.js' &&
        ! printf '%s\n' "$rel" | grep -qxE 'assets/[A-Za-z0-9._-]+\.jpg'; then
        echo "check-site: $rel is not a page file"
        failed=1
    fi

    if printf '%s\n' "$rel" | grep -qiE "$game_pattern" ||
        printf '%s\n' "$rel" | grep -qiE 'game-data-staging|PharaohData'; then
        echo "check-site: $rel looks like game data"
        failed=1
    fi

    size=$(wc -c < "$dir/$rel" | tr -d ' ')
    if [ "$size" -gt "$big_limit" ]; then
        echo "check-site: $rel is $size bytes, over the 50 MB cap"
        failed=1
    fi
done < "$list"

# Every script the page imports must sit next to it. A missing one stops the page
# before it draws anything, which is how a missing files.js broke the live site.
for js in "$dir"/*.js; do
    [ -f "$js" ] || continue
    base=${js##*/}
    grep -oE '(from|import) "\./[^"]+"' "$js" | sed 's/^[a-z]* "\.\///; s/"$//' | sort -u > "$imports"
    while IFS= read -r target; do
        [ -n "$target" ] || continue
        if [ ! -f "$dir/$target" ]; then
            echo "check-site: missing $target (imported by $base)"
            failed=1
        fi
    done < "$imports"
done

if [ "$failed" -ne 0 ]; then
    echo "check-site: FAILED"
    exit 1
fi

echo "check-site: OK"
