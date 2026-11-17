// Unit test for the canvas fit in web/fit.js. No browser, no game data: every size below is
// made up. Run with `node web/tests/fit-test.mjs`.
import { fitSize, MIN_WIDTH, MIN_HEIGHT } from "../fit.js";

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error("FAIL: " + name + ": got " + a + ", want " + e);
        failures += 1;
    }
}

// The smoke run's window: the canvas is the window.
check("1920x1080 at ratio 1", fitSize(1920, 1080, 1), {
    width: 1920,
    height: 1080,
    pixelWidth: 1920,
    pixelHeight: 1080,
});

// The smaller window the smoke run changes to: short in height only, so it is filled.
check("1280x720 at ratio 1", fitSize(1280, 720, 1), {
    width: 1280,
    height: 720,
    pixelWidth: 1280,
    pixelHeight: 720,
});

// A high-density screen draws the same CSS size at twice the pixels.
check("1280x720 at ratio 2", fitSize(1280, 720, 2), {
    width: 1280,
    height: 720,
    pixelWidth: 2560,
    pixelHeight: 1440,
});

// Fractions are rounded down, never up: a canvas may not be bigger than the screen it fills.
check("fractional window at ratio 1.5", fitSize(1366.7, 768.9, 1.5), {
    width: 1366,
    height: 768,
    pixelWidth: 2049,
    pixelHeight: 1152,
});

// Below the minimum in both directions the canvas is still the window size; the Rust side
// shrinks the picture so the game lays out on at least 1024x768 logical pixels.
check("800x600", fitSize(800, 600, 1), {
    width: 800,
    height: 600,
    pixelWidth: 800,
    pixelHeight: 600,
});

// Exactly the minimum is not below it.
check("1024x768", fitSize(1024, 768, 1), {
    width: 1024,
    height: 768,
    pixelWidth: 1024,
    pixelHeight: 768,
});

// A window narrower than the minimum but tall enough is still filled.
check("900x1200", fitSize(900, 1200, 1), {
    width: 900,
    height: 1200,
    pixelWidth: 900,
    pixelHeight: 1200,
});

// A browser that reports no usable ratio draws at one pixel per CSS pixel rather than
// computing a zero or not-a-number bitmap.
for (const ratio of [0, Number.NaN, undefined]) {
    check("ratio " + String(ratio), fitSize(1280, 720, ratio), {
        width: 1280,
        height: 720,
        pixelWidth: 1280,
        pixelHeight: 720,
    });
}

// A window with no size at all must still give a canvas the game can draw into.
check("0x0", fitSize(0, 0, 1), {
    width: 1,
    height: 1,
    pixelWidth: 1,
    pixelHeight: 1,
});

if (failures > 0) {
    console.error(failures + " fit test(s) failed");
    process.exit(1);
}
console.log("fit-test: OK");
