# Design: web-fit

## The canvas belongs to the page, the surface follows it
Winit 0.30 on the web does not size the canvas's bitmap any more: as of 0.29 "the canvas
output bitmap size is no longer adjusted" and "the canvas size is not controlled by Winit
anymore and external changes to the canvas size will be reported through
`WindowEvent::Resized`" (`winit` changelog, 0.29.0, read in docs-mcp). It watches the canvas
with a `ResizeObserver` (box `device-pixel-content-box` where the browser has it) and reports
the element's device-pixel box, which is exactly the CSS size times `devicePixelRatio`.

So the page sets both sizes and the program only listens:

- `web/fit.js fitSize()` decides the CSS size and the bitmap size. The bitmap is
  `floor(css * devicePixelRatio)`; the CSS size is the window's inner size, floored.
- `web/main.js fitCanvas()` writes `canvas.style.width/height` and `canvas.width/height` from
  it and logs `osiris web: set canvas to <bitmap width>x<bitmap height>`.
- Winit's observer then sends `WindowEvent::Resized` with that device-pixel size, the existing
  branch in `main.rs` calls `gfx.resize`, and `Surface::configure` gets the new size. Nothing
  new is needed to carry a window change into the surface, so the issue's "send it from a
  `ResizeObserver` if winit does not" fallback is not used. The browser branch logs
  `osiris web: resize to <w>x<h>` after the resize so the smoke test can prove the event
  really arrives, and that the surface is as big as the canvas.

Two winit window attributes have to go on the browser path: `with_inner_size` and
`with_min_inner_size`. On the web winit writes both onto the canvas's CSS (`set_canvas_size` and
`set_canvas_min_size`), so `with_inner_size(1280x768)` would undo the fit, and
`with_min_inner_size(1024x768)` would keep the canvas at 1024x768 CSS pixels in a smaller
window. The desktop path keeps both.

The browser surface in `gfx.rs` starts at the canvas's bitmap size (`canvas.width()`,
`canvas.height()`) rather than at `client_width * scale` rounding. The bitmap is what the
drawing buffer really is, so the first frame fills it exactly instead of showing a one-pixel
edge when `devicePixelRatio` is not a whole number.

## The 1024x768 minimum against the 1280x720 check
The issue asks for two things that meet in the middle:

1. "Minimum size 1024x768: below that, keep 1024x768 and let the page scroll."
2. The acceptance run changes the window to 1280x720 and expects
   `osiris web: set canvas to 1280x720`.

A window of 1280x720 is below the minimum in height, so a per-dimension floor would keep it
768 high and print `1280x768`, and the game would not fill a 720-high window. Filling the
window is the whole point of the change, so the floor is applied only when the window is
smaller than 1024x768 in **both** directions. That keeps a genuinely small window (a phone, a
tiny browser window) at a usable 1024x768 with the page scrolling, and lets a window that is
short in only one direction be filled, which is what 1280x720 is. `fitSize` is the one place
this rule lives, and `web/tests/fit-test.mjs` pins all three cases.

## Full screen
`canvas.requestFullscreen()` needs a real user gesture. The "Fullscreen" button has one, and a
key press is one too, so the page listens for F11 on the document (not only on the canvas, so
it works before the canvas has the keyboard) and for clicks on the button. Both call the same
`toggleFullscreen()`: `document.exitFullscreen()` when the page is already full screen,
`canvas.requestFullscreen()` otherwise. Escape is left to the browser, which leaves full
screen by itself.

Winit's F11 handling in `main.rs` (`toggle_fullscreen` → `Window::set_fullscreen`) also ends
up in the browser's Fullscreen API on the same canvas, and it reads the same
`document.fullscreenElement`, so both handlers ask for the same state on one key press.
Leaving full screen also has winit put back the windowed size it remembered
(`request_inner_size`), which sets the canvas's CSS size, so the page refits on
`fullscreenchange` (in a `requestAnimationFrame`, since the browser has not relaid the page out
when the event fires) and on every window `resize`.

`SMOKE_VIEWPORT` must not really go full screen (headless Chromium's full screen is not worth
depending on), so the smoke test stubs `canvas.requestFullscreen` for one click of the button
and one F11 key press and checks that both call it, then puts the real function back.

## The page around the game
`#start` (status line, folder field, drag-and-drop, "Forget game files") already hides when the
game starts. What is added is the way back and the full screen button: a small `#controls`
strip, hidden until the game starts, holding "Fullscreen" and "Page". "Page" brings `#start`
back over the running game (it already sits above the canvas once made `position: fixed`), and
the same button, now "Back to game", hides it again.

## The checks
- `web/tests/fit-test.mjs` runs under Node with no browser: window size in, canvas size out,
  `devicePixelRatio`, rounding down, the 1024x768 floor and the "short in one direction" case.
- `SMOKE_VIEWPORT=WxH` with `SMOKE_MISSION=menu` is the end-to-end proof: the page's own
  folder picker starts the game (so `main.js` sets the canvas), the canvas fills the window,
  winit's resize reaches the surface, the city runs two months, and the screenshot's PNG
  header and its edges show a filled frame. The borders are read from the canvas with
  `gl.readPixels` and measured as the median run of pure black pixels from each edge; a black
  bar left by a surface smaller than the bitmap would be hundreds of pixels wide, far over the
  8 px the acceptance allows. Then the window changes to 1280x720 and the page prints and
  applies the smaller size.
- The existing smoke runs (no game data, `SMOKE_MISSION=menu`, `SMOKE_WRAP`,
  `SMOKE_REMEMBER=1`) keep their own canvas-sized path and must still pass.
