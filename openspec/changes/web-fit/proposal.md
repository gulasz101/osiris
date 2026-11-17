# web-fit: the game fills the browser window, with full screen

## Why
The page draws the game on a canvas of a fixed 1280x768, set in `web/main.js` (lines 106-109)
and passed to the program in `crates/osiris-app/src/web.rs` (line 212). On a 1920x1080 screen
the game is a box in the corner of the page with the start page's furniture around it. A game
in a browser should fill the window, follow it when it changes, and be able to go full screen.

## What changes
- `web/fit.js` (new): `fitSize(viewportWidth, viewportHeight, devicePixelRatio)`, the one
  place that turns a window size into a canvas size: CSS size is the window size, pixel size
  is the CSS size times `devicePixelRatio` rounded down, and a window smaller than 1024x768 in
  both directions keeps 1024x768 so the page scrolls instead of the game shrinking.
- `web/main.js`: `fitCanvas()` applies `fitSize` to the canvas, logs
  `osiris web: set canvas to <pixel width>x<pixel height>`, and runs when the game starts,
  when the window is resized and when the page comes back out of full screen. The fixed
  1280x768 is gone. The "Fullscreen" button and the F11 key call `canvas.requestFullscreen()`
  (and `document.exitFullscreen()` when the page is already full screen). A small corner
  control, which has the "Fullscreen" button and a "Page" link, appears once the game starts;
  the link brings the start page (status line, folder field, links) back over the game.
- `web/index.html`: the page around the canvas: the canvas fills the window, the start page
  covers it while it is up, and the corner control's styling.
- `crates/osiris-app/src/web.rs`: `start_game` takes the canvas's size for `args.size`
  instead of the fixed 1280x768.
- `crates/osiris-app/src/main.rs`: the browser path takes the size of the page's canvas for
  both the surface and the fallback canvas bitmap instead of `args.size`, and no longer asks
  winit for an inner size or a minimum inner size (on the web those set the canvas's CSS size,
  which is the page's job now). A `WindowEvent::Resized` in the browser logs
  `osiris web: resize to <w>x<h>` after `gfx.resize`, so the smoke test can see that the
  surface followed the canvas.
- `crates/osiris-app/src/gfx.rs`: the browser surface starts at the canvas's own bitmap size.
- `web/tests/fit-test.mjs` (new): a Node unit test for `fitSize` (window size, `devicePixelRatio`,
  rounding down, the 1024x768 floor), added to `scripts/check.sh`.
- `web/tests/smoke.mjs`: `SMOKE_VIEWPORT=WxH` opens the page at that window size and, with
  `SMOKE_MISSION=menu`, starts the game through the page's own folder picker, checks the
  canvas log line and the canvas filling the window, runs the city two months, checks the
  screenshot is `WxH` with no black border wider than 8 px, then changes the window to
  1280x720 and checks the new log line and the smaller canvas.
- `scripts/pages-site.sh`, `scripts/check-site.sh`: `fit.js` is a page file and may be
  published.
- `docs/STATUS.md`: a "Works" line naming the `SMOKE_VIEWPORT` command.

## Out of scope
- The game's own drawing: the renderer already lays the interface out in screen pixels
  (`gfx.rs` `fit`), so a bigger surface shows more of the city. No game rule, art or UI
  placement changes.
- The desktop build: its window, its saved window size, its own F11 and its minimum size stay
  exactly as they are.
- Touch controls, a mobile page, and an interface scale slider for small screens.
- Remembering the window size between visits: the page always starts at the window's size.

## Risks
- A big window means a big surface and more pixels for the city to draw. A 4K window is
  3840x2160 device pixels; the browser build already draws at the size of the window it is
  given, and the smoke run at 1920x1080 is the check that it keeps up.
- `devicePixelRatio` above 1 multiplies the pixels again (a 1920x1080 window on a Retina
  display is 3840x2160 device pixels). The page follows the rule the issue asks for; if that
  turns out too slow on a Retina laptop, the follow-up is a cap on the pixel size, not a
  change here.
- Winit owns full screen on the canvas as well (`set_fullscreen`), and its F11 in
  `main.rs` toggles it. The page's own F11 does the same thing through the same browser API,
  so a press asks for the same state twice instead of fighting itself.
- The issue asks for a 1024x768 minimum and for a 1280x720 window to be filled exactly; those
  two meet at 1280x720 and disagree. `design.md` records the reading taken and why.
