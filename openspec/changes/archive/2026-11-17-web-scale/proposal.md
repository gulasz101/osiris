# web-scale: shrink the picture for small browser windows

## Why
The game never goes below a 1024x768 interface. On desktop the window cannot be smaller
(`MIN_WINDOW`, `main.rs:262`). In the browser it can, and many browser windows are: a
1366×630 laptop gives about 1366×500 after the browser bar, a 1280×800 MacBook about
1280×700. Today `web/fit.js` `fitSize` keeps the canvas at 1024×768 and lets the page scroll
when both dimensions are below minimum, or fills the window when only one direction is short —
which gives a lower-than-tested screen (e.g. 1366×630).

## What changes
In the browser build only, cap the interface scale so the logical screen is never smaller than
1024×768 in either dimension:

```
scale = min(chosen_scale, bitmap_w / 1024.0, bitmap_h / 768.0)
```

where `chosen_scale` is what `ui_scale` returns today (system ratio times Auto or the player's
Interface size). The bitmap stays at device pixels. The logical screen keeps the window's shape:
a 1366×630 window at ratio 1 gives scale ≈ 0.82 and a 1665×768 screen, not a letterboxed 4:3.

The same cap applies when the player picks 150% or 200%. Log once per change:
`osiris web: interface scale <s with 2 decimals>, screen <W>x<H>`.

In `web/fit.js` remove the 1024×768 floor: the canvas is always the window's size. Update tests.

## What does not change
- Desktop build behaviour (behind `#[cfg(not(target_arch = "wasm32"))]`).
- Game rules or how the game looks at 1024×768 and above.
- Mouse coordinate handling: the cursor already goes through `scale`, so capping it fixes mouse
  coordinates automatically.

## Files touched
- `crates/osiris-app/src/gfx.rs` — cap scale on wasm32 in `Gfx::scale()` or `ui_scale`.
- `web/fit.js` — remove the MIN_WIDTH/MIN_HEIGHT floor.
- `web/tests/fit-test.mjs` — update tests for new fitSize behaviour.
- `docs/STATUS.md` — note that small windows now shrink instead of scroll.
