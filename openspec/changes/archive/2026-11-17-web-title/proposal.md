# web-title: a title screen, an Enter button and a loading screen

## Why
Wojtek's review (GUL-1739): the page works but looks like an MVP. There is no start button: the
player picks a folder (or the page finds the copy in browser storage) and the game starts on its
own after a pause with nothing on screen to say it is coming. He wants a page he can show on his
blog: a title screen with artwork, a menu to enter the game or load another folder, a loading
screen until the game is up, and a nicer saved games manager.

## What changes
- `web/index.html`: a title screen over original artwork (`web/assets/title.jpg`, made with the
  Image Studio's Gemini engine for this page, no art from the game). The menu holds
  "Enter the game", "Choose your Pharaoh folder" (or "Use another Pharaoh folder" once files are
  known), "Saved games" and "Forget game files".
- `web/main.js`: a pick or a restore only mounts the files and shows Enter; Enter starts the game.
  Enter puts up a loading screen (`#loading`, over `web/assets/archive.jpg`) that stays until the
  game calls `globalThis.osirisReady`. The copy into browser storage starts at the pick and its
  bar is a small strip at the bottom of the page instead of a cover over everything.
- `crates/osiris-app/src/web.rs` and `main.rs`: `web::notify_ready()` calls the page's
  `osirisReady` at the end of `finish_start`, wasm only.
- The saved games manager is a card over the archive artwork, reachable from the title screen
  too, with an empty state, Escape to close, and a styled import button.
- `scripts/pages-site.sh` publishes `web/assets/*.jpg`; `scripts/check-site.sh` allows them.
- `web/tests/smoke.mjs`: the pick and remember runs press Enter as a player would.

## What does not change
- Game rules, the game's own screens, and the desktop build.
- The element ids the smoke test uses (`#start`, `#folder`, `#status`, `#progress`, `#controls`,
  `#saves`, `#page`, `#forget`).
