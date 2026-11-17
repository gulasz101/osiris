// How big the game's canvas should be. The page sets both sizes: the CSS size is what the
// player sees, the bitmap size is the drawing buffer. Winit's web backend watches the canvas
// and reports the CSS size times `devicePixelRatio` as a `Resized` event, which is how the
// game learns to redraw at the new size (see docs and openspec/changes/web-fit/design.md).

/** The game's own minimum screen, in CSS pixels: below this the page scrolls. */
export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 768;

/**
 * The canvas size for a window of `viewportWidth` x `viewportHeight` CSS pixels.
 *
 * The CSS size is the window's, floored to whole pixels; the bitmap size is that times
 * `devicePixelRatio`, also floored down. A window smaller than the game's minimum in both
 * directions keeps the minimum and lets the page scroll; a window that is short in only one
 * direction is filled, so a 1280x720 screen is filled rather than scrolled.
 *
 * Returns `{ width, height, pixelWidth, pixelHeight }`.
 */
export function fitSize(viewportWidth, viewportHeight, devicePixelRatio) {
    const tooSmall = viewportWidth < MIN_WIDTH && viewportHeight < MIN_HEIGHT;
    const width = tooSmall ? MIN_WIDTH : Math.max(1, Math.floor(viewportWidth) || 1);
    const height = tooSmall ? MIN_HEIGHT : Math.max(1, Math.floor(viewportHeight) || 1);
    const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return {
        width,
        height,
        pixelWidth: Math.max(1, Math.floor(width * ratio)),
        pixelHeight: Math.max(1, Math.floor(height * ratio)),
    };
}
