#!/usr/bin/env node
// Prints where a frame-trace run's time went (web-frame-trace design 3).
//
// Two numbers matter. The slice table says what the main thread spent its time on; the frame
// pacing line says how often the browser asked it for a frame at all, which is where a slow
// frame hides from the program's own timers.
//
// Usage: node scripts/trace-top.mjs <trace.json>
//
// The trace is the file `SMOKE_TRACE=<file> scripts/web-smoke.sh` writes: an array of Chrome
// trace events from CDP `Tracing`. A DevTools "Save profile" file (`{"traceEvents":[...]}`) is
// accepted too, so a trace taken by hand works the same way.
//
// The script picks the renderer's main thread, sums the complete slices (`ph: "X"`) by name and
// prints the ten with the biggest total, then the gap between two `requestAnimationFrame`
// callbacks, which is the number that explains a slow frame the program's own timers miss.

import fs from "node:fs";

const file = process.argv[2];
if (!file) {
    console.error("usage: node scripts/trace-top.mjs <trace.json>");
    console.error("make one with: SMOKE_TRACE=/tmp/osiris-trace.json SMOKE_GPU=1 scripts/web-smoke.sh");
    process.exit(1);
}

let raw;
try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
    console.error(`cannot read ${file}: ${error.message}`);
    process.exit(1);
}
const events = Array.isArray(raw) ? raw : Array.isArray(raw.traceEvents) ? raw.traceEvents : null;
if (events === null) {
    console.error(`${file} holds neither a list of trace events nor a {"traceEvents": [...]} object`);
    process.exit(1);
}

/** A complete slice, which is the only shape whose `dur` is the time it took. */
const slices = events.filter((event) => event.ph === "X" && typeof event.dur === "number" && event.dur > 0);

/** The total time of the slices on one thread, per event name. */
function byName(threadSlices) {
    const totals = new Map();
    for (const event of threadSlices) {
        const entry = totals.get(event.name) ?? { name: event.name, dur: 0, count: 0 };
        entry.dur += event.dur;
        entry.count += 1;
        totals.set(event.name, entry);
    }
    return [...totals.values()];
}

// The main thread is the one that runs the event loop tasks; when the trace has no RunTask
// at all, the busiest thread is the closest thing to it.
const threads = new Map();
for (const event of slices) {
    const key = `${event.pid}:${event.tid}`;
    const thread = threads.get(key) ?? { key, slices: [], runTask: 0, total: 0 };
    thread.slices.push(event);
    thread.total += event.dur;
    if (event.name === "RunTask") thread.runTask += event.dur;
    threads.set(key, thread);
}
if (threads.size === 0) {
    console.error(`${file} holds no complete slices (ph: "X"), so there is nothing to sum`);
    process.exit(1);
}
const ranked = [...threads.values()].sort((a, b) => b.runTask - a.runTask || b.total - a.total);
const main = ranked[0];
const why = main.runTask > 0 ? "the most RunTask time" : "the most slice time";

// The trace's own span, from the first slice to the end of the last one.
let first = Infinity;
let last = -Infinity;
for (const event of slices) {
    first = Math.min(first, event.ts);
    last = Math.max(last, event.ts + event.dur);
}
const spanMs = (last - first) / 1000;

const rows = byName(main.slices)
    .sort((a, b) => b.dur - a.dur || b.count - a.count)
    .slice(0, 10);

const ms = (micros) => (micros / 1000).toFixed(1);
const id = (width, value) => String(value).padStart(width);

console.log(`trace ${file}`);
console.log(`${events.length} events, ${slices.length} complete slices, ${spanMs.toFixed(1)} ms of trace`);
console.log(`main thread ${main.key} (${why}), ${main.slices.length} slices, ${ms(main.total)} ms of work`);
console.log("");
console.log("the ten biggest slices by total time on that thread:");
console.log(`${id(9, "total ms")}  ${id(6, "count")}  name`);
for (const row of rows) {
    console.log(`${id(9, ms(row.dur))}  ${id(6, row.count)}  ${row.name}`);
}

// rAF callbacks are the frames the browser offered the page. The mean gap between two of them
// is the frame time a player would see, whatever the program's own timers say.
const frames = (main.slices.some((event) => event.name === "FireAnimationFrame") ? main.slices : slices)
    .filter((event) => event.name === "FireAnimationFrame")
    .map((event) => event.ts)
    .sort((a, b) => a - b);
if (frames.length < 2) {
    console.log("");
    console.log("rAF gap: no requestAnimationFrame callbacks in this trace");
} else {
    const gaps = frames.slice(1).map((ts, index) => (ts - frames[index]) / 1000).sort((a, b) => a - b);
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const median = gaps[Math.floor(gaps.length / 2)];
    console.log("");
    console.log(
        `rAF gap: mean ${mean.toFixed(1)} ms over ${frames.length} callbacks ` +
            `(median ${median.toFixed(1)} ms, worst ${gaps[gaps.length - 1].toFixed(1)} ms, ` +
            `best ${gaps[0].toFixed(1)} ms)`
    );
}

/** The mean gap between two of the named instant events, or null when the trace has fewer than two. */
function instantGap(name) {
    const stamps = events
        .filter((event) => event.ph === "I" && event.s === "t" && event.name === name)
        .map((event) => event.ts)
        .sort((a, b) => a - b);
    if (stamps.length < 2) return { count: stamps.length, gap: null };
    const gaps = stamps.slice(1).map((ts, index) => (ts - stamps[index]) / 1000);
    return { count: stamps.length, gap: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length };
}

// BeginFrame is the display asking for a frame, DroppedFrame the browser throwing the offer away
// unrendered, and RequestMainThreadFrame the moment it finally asks the main thread to draw.
// When those three disagree the page is not the thing that is slow.
const begin = instantGap("BeginFrame");
const dropped = instantGap("DroppedFrame");
const requested = instantGap("RequestMainThreadFrame");
if (begin.count > 0 || requested.count > 0) {
    const every = (value) => (value === null ? "n/a" : `${value.toFixed(1)} ms`);
    console.log(
        `frame pacing: ${begin.count} BeginFrame (one every ${every(begin.gap)}), ` +
            `${dropped.count} DroppedFrame, ${requested.count} RequestMainThreadFrame ` +
            `(one every ${every(requested.gap)})`
    );
}
