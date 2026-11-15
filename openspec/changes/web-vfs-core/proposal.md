# web-vfs-core: one file layer that works on desktop and in the browser

## Why
The browser has no file system: on `wasm32-unknown-unknown` every `std::fs` call returns an error.
Osiris reads the game data and writes saves through `std::fs` in 98 places
(`scripts/no-direct-fs.sh` lists them). We need one small layer that is `std::fs` on desktop and
an in-memory store in the browser. The page fills that store with the player's dropped folder.

## What changes
- New crate `crates/osiris-vfs` (no dependencies): the functions the code uses today
  (`read`, `read_to_string`, `write`, `read_dir`, `create_dir_all`, `remove_file`, `remove_dir_all`,
  `rename`, `is_dir`, `is_file`, `exists`, `modified`, `len`, `open`), plus `mount` in the browser.
- The game-data crates switch to it: `osiris-formats`, `osiris-sim`, `osiris-audio`, `osiris-bink`.
  After this change `scripts/no-direct-fs.sh crates/osiris-formats/src crates/osiris-sim/src
  crates/osiris-audio/src crates/osiris-bink/src` prints `OK`.

## Out of scope
`osiris-app` (changes `web-vfs-app` and `web-vfs-main`). Saving the in-memory store between page
loads (a later change).
