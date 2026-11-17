// Unit test for web/progress.js: the bar's line, the 100 ms repaint limit and how many
// reads runAll keeps in flight. No browser and no game data: a made-up element and
// made-up bytes. Run with `node web/tests/progress-test.mjs`.

import { INTERVAL_MS, MAX_READS, createBar, progressText, readAll } from "../progress.js";

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error("FAIL: " + name + ": got " + a + ", want " + e);
        failures += 1;
    }
}

function checkTrue(name, actual) {
    if (!actual) {
        console.error("FAIL: " + name);
        failures += 1;
    }
}

// ── The line above the bar ─────────────────────────────────────────
check("the issue's example", progressText(412, 1335), "Reading game files: 412 / 1335 (31%)");
check("nothing read yet", progressText(0, 1335), "Reading game files: 0 / 1335 (0%)");
check("everything read", progressText(1335, 1335), "Reading game files: 1335 / 1335 (100%)");
check("an empty folder", progressText(0, 0), "Reading game files: 0 / 0 (0%)");
// 412 of 1335 is 30.86%, which rounds up: the example in the issue says 31.
checkTrue("the percentage is rounded", progressText(412, 1335).includes("(31%)"));

// ── The bar, on a clock the test moves ─────────────────────────────
/** A stand-in for `#progress` with its text and fill, enough for createBar. */
function fakeElement() {
    const text = { textContent: "" };
    const fill = { style: { width: "" } };
    return {
        hidden: true,
        text,
        fill,
        querySelector(selector) {
            if (selector === "#progress-text") return text;
            if (selector === "#progress-fill") return fill;
            return null;
        },
    };
}

let clock = 0;
const element = fakeElement();
const bar = createBar(element, { now: () => clock });

check("hidden until shown", element.hidden, true);
bar.show(10);
check("shown with nothing read", element.hidden, false);
check("the first line", element.text.textContent, "Reading game files: 0 / 10 (0%)");
check("the fill starts empty", element.fill.style.width, "0%");

// A repaint inside the 100 ms window is skipped.
clock = INTERVAL_MS - 1;
bar.update(3);
check("repaint inside 100 ms", element.text.textContent, "Reading game files: 0 / 10 (0%)");
// The clock has moved a full interval since the show, so this one lands.
clock = INTERVAL_MS;
bar.update(3);
check("repaint after 100 ms", element.text.textContent, "Reading game files: 3 / 10 (30%)");
check("the fill follows", element.fill.style.width, "30%");
// And the next one is again at most once per interval.
clock = INTERVAL_MS + 50;
bar.update(7);
check("repaint too soon after the last", element.text.textContent, "Reading game files: 3 / 10 (30%)");
clock = 2 * INTERVAL_MS;
bar.update(7);
check("repaint a full interval later", element.text.textContent, "Reading game files: 7 / 10 (70%)");

// The last count is drawn whatever the clock says, and the bar goes away.
clock = 2 * INTERVAL_MS + 1;
bar.finish(10);
check("the final line", element.text.textContent, "Reading game files: 10 / 10 (100%)");
check("hidden when the read ends", element.hidden, true);

// ── Reading, eight at a time ───────────────────────────────────────
/** `count` made-up files, each a path and an index. */
function items(count) {
    return Array.from({ length: count }, (_, i) => ({ path: "Data/f" + i + ".bin", i }));
}

// A read that settles on the next microtask, so a worker has to wait for it.
async function shortRead(item) {
    await Promise.resolve();
    return new Uint8Array([item.i]);
}

const many = items(20);
const taken = [];
let inFlight = 0;
let mostInFlight = 0;
const reads = async (item) => {
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    try {
        return await shortRead(item);
    } finally {
        inFlight -= 1;
    }
};
const readBar = fakeElement();
const readCount = await readAll(many, reads, (item, bytes) => taken.push([item.i, bytes[0]]), createBar(readBar, { now: () => 0 }));
check("every file is read", readCount, 20);
check("every file is taken, in order", taken.map(([i]) => i), many.map((item) => item.i));
checkTrue("more than one read at a time", mostInFlight > 1);
checkTrue("never more than MAX_READS at a time", mostInFlight <= MAX_READS);
check("MAX_READS is the issue's number", MAX_READS, 8);
check("the bar is hidden after the read", readBar.hidden, true);
check("the bar ends at 100%", readBar.text.textContent, "Reading game files: 20 / 20 (100%)");

// A short list cannot start more workers than it has files.
const few = items(3);
let fewInFlight = 0;
let fewMost = 0;
await readAll(few, async (item) => {
    fewInFlight += 1;
    fewMost = Math.max(fewMost, fewInFlight);
    await Promise.resolve();
    fewInFlight -= 1;
    return new Uint8Array([item.i]);
}, () => {});
check("a short list uses only its own files", fewMost, 3);

// A failed read stops the others: nothing after the failing file is mounted, and the
// bar is hidden so the page can show the error.
const failing = items(40);
const mounted = [];
const failBar = fakeElement();
let rejected = null;
try {
    await readAll(failing, async (item) => {
        await Promise.resolve();
        if (item.i === 5) throw new Error("gone");
        return new Uint8Array([item.i]);
    }, (item) => mounted.push(item.i), createBar(failBar, { now: () => 0 }));
} catch (err) {
    rejected = err;
}
checkTrue("a failed read rejects", rejected instanceof Error);
check("the bar is hidden after a failure", failBar.hidden, true);
checkTrue("nothing far past the failure is mounted", mounted.every((i) => i < 20));
checkTrue("the failing file itself is not mounted", !mounted.includes(5));

if (failures > 0) {
    console.error("progress-test: " + failures + " failure(s)");
    process.exitCode = 1;
} else {
    console.log("progress-test: OK");
}
