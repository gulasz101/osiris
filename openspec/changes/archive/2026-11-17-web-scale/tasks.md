# web-scale: tasks

## 1. Cap interface scale in `Gfx::scale()` (wasm32 only)

- [x] 1a. Add the cap inside `Gfx::scale()` behind `#[cfg(target_arch = "wasm32")]`:
        `scale = min(chosen_scale, bitmap_w / 1024.0, bitmap_h / 768.0)`
        where `bitmap_w` and `bitmap_h` are `self.config.width` and `self.config.height`.
- [x] 1b. Add a log line in `Gfx::fit()` when the capped scale differs from the uncapped one:
        `osiris web: interface scale <s with 2 decimals>, screen <W>x<H>`
        where W and H are the logical screen dimensions (bitmap / scale).

## 2. Unit test for the scale cap

- [x] 2a. At bitmap 1366×630, ratio 1: `ui_scale(1.0, 630.0)` returns 1.0; capped scale is
        `min(1.0, 1366/1024, 630/768) = min(1.0, 1.333, 0.820) = 0.82`. Logical screen:
        [1366/0.82, 630/0.82] ≈ [1665.9, 768.3]. Verify with an assertion.
- [x] 2b. At bitmap 1920×1080, ratio 1: cap does nothing (both ratios > 1). Scale stays 1.0.

## 3. Mouse coordinate test

- [x] 3a. Unit test: at bitmap 1366×630 and ratio 1 with capped scale 0.82, a physical point
        (683, 315) maps to logical (683/0.82, 315/0.82) ≈ (832.9, 384.1), within 0.1 of
        (832.6, 384.0). This verifies the mouse follows the capped scale.

## 4. Update `web/fit.js` — remove the 1024×768 floor

- [x] 4a. Remove the `tooSmall` logic from `fitSize`. The canvas is always the window's CSS size.
        Keep MIN_WIDTH/MIN_HEIGHT as constants (documented) but do not use them in fitSize.
- [x] 4b. Update `web/tests/fit-test.mjs`: the 800×600 test now gives {width: 800, height: 600}
        instead of {width: 1024, height: 768}.

## 5. Desktop build still compiles and tests pass

- [x] 5a. `cargo test --workspace` passes (native target only).
- [x] 5b. `cargo check --target wasm32-unknown-unknown -p osiris-app` succeeds.

## 6. Smoke tests for small windows

- [x] 6a. Modified `smoke.mjs` to accept comma-separated viewports (`SMOKE_VIEWPORT=1366x630,800x600,1920x1080`).
        Added scroll bar check (no scroll bars at initial viewport size) and interface scale
        logging detection for each viewport. Prints `osiris web: small window OK` when all
        small viewports pass.
- [x] 6b. Same checks apply to all small viewports in the comma-separated list.
- [x] 6c. The 1920×1080 viewport is checked like any other (prints `viewport OK`).
        Note: actual smoke test execution requires OSIRIS_DATA; code changes are complete.

## 7. Update docs/STATUS.md

- [x] 7a. Updated "The canvas fills the window" section: small windows shrink the picture,
        text below scale 1 is resampled pixel art, comma-separated viewport smoke test documented.
