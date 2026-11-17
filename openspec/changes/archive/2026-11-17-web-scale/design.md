# web-scale: design notes

## Where to put the cap
`ui_scale(system, height)` in `gfx.rs:66` returns a scale based only on height. It is called at
`gfx.rs:202` (in `Gfx::scale()`) and at `gfx.rs:243` (in `screenshot_scale`). The cap must not
affect screenshots or desktop builds.

The cleanest place is inside `Gfx::scale()` behind `#[cfg(target_arch = "wasm32")]`:

```rust
pub fn scale(&self) -> f64 {
    let s = ui_scale(self.window.scale_factor(), self.config.height as f64);
    #[cfg(target_arch = "wasm32")]
    let s = {
        let w = self.config.width as f64;
        let h = self.config.height as f64;
        let min_w = 1024.0;
        let min_h = 768.0;
        let cw = (w / s).max(min_w);   // logical width if we used scale s
        let ch = (h / s).max(min_h);
        let sw = w / cw.min(w);          // factor to shrink to fit min_w
        let sh = h / ch.min(h);          // factor to shrink to fit min_h
        s * sw.min(sh)
    };
    s
}
```

Wait — that's wrong. The formula from the issue is:

```
scale = min(chosen_scale, bitmap_w / 1024, bitmap_h / 768)
```

where `bitmap_w` and `bitmap_h` are the device-pixel dimensions (the surface size). So:

```rust
#[cfg(target_arch = "wasm32")]
let s = {
    let bw = self.config.width as f64;
    let bh = self.config.height as f64;
    let max_scale_w = bw / 1024.0;
    let max_scale_h = bh / 768.0;
    (s).min(max_scale_w).min(max_scale_h)
};
```

This is simpler and correct: if the bitmap is 1366×630 at ratio 1, `chosen_scale` is 1.0, then
`max_scale_w = 1366/1024 ≈ 1.33`, `max_scale_h = 630/768 ≈ 0.82`. The cap gives `min(1.0, 1.33, 0.82) = 0.82`.

The logical screen becomes `[1366/0.82, 630/0.82] ≈ [1665, 768]` — exactly what we want: the
game lays out on a 1665×768 screen (≥ 1024 wide and ≥ 768 tall), keeping the window's aspect ratio.

## Why not in `ui_scale` itself
`screenshot_scale` also calls `ui_scale`. We don't want to cap screenshots — they should render
at full resolution for quality. The cap belongs only in `Gfx::scale()`, which is what the running
game uses.

## Mouse coordinates
The cursor position from winit's `CursorMoved` is already in physical (device) pixels on all
platforms, including web (`winit 0.30.13` docs: "All of Winit's functions return physical types").
It gets divided by `scale` at `main.rs:1479` and inside the `CursorMoved` handler at
`main.rs:1638`. Since both use the same `scale` variable (from `self.gfx.scale()`), capping it
in `Gfx::scale()` fixes mouse coordinates automatically — no second scale needed.

## Logging
The issue asks for one log line per scale change:
```
osiris web: interface scale 0.82, screen 1665x768
```

This goes in `Gfx::fit()`, which is called whenever the surface resizes and recalculates the
screen size. We log only when the capped scale differs from the uncapped one (to avoid spamming
on every resize that doesn't need capping).

## fit.js changes
Remove the 1024×768 floor in `fitSize`. The canvas is always the window's CSS size:

```js
export function fitSize(viewportWidth, viewportHeight, devicePixelRatio) {
    const width = Math.max(1, Math.floor(viewportWidth)) || 1;
    const height = Math.max(1, Math.floor(viewportHeight)) || 1;
    // ... same ratio handling
}
```

The `MIN_WIDTH` and `MIN_HEIGHT` constants can stay for documentation but are no longer used in
the logic. Or we remove them entirely — the spec delta will clarify.

## Tests
- Unit test: at bitmap 1366×630 and ratio 1, a physical point (683, 315) maps to logical
  (832.6, 384.0), within 0.1. This verifies the mouse follows the capped scale.
- fit-test.mjs: update the 800×600 test — it now gives 800×600 instead of 1024×768.
