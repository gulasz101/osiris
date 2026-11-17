// Unit test for web/boot.js: the start's steps, the lines the page prints while it gets
// ready, the wasm size behind the boot bar, and the byte count while the wasm downloads.
// No browser and no game data. Run with `node web/tests/boot-test.mjs`.

import { STEPS, downloadText, elapsedText, fetchWasm, stepAt, wasmSize } from "../boot.js";

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error("FAIL: " + name + ": got " + a + ", want " + e);
        failures += 1;
    }
}

// ── The steps: the names web.rs sends, in order, the bar always going forward ──
check("step names", STEPS.map((s) => s.name), ["files", "rules", "graphics", "menu"]);
check("the last step ends the bar", STEPS[STEPS.length - 1].to, 100);
let last = 0;
for (const s of STEPS) {
    if (!(s.to > last)) check("step " + s.name + " goes forward", s.to, "> " + last);
    last = s.to;
}
check("first step", stepAt("files"), { index: 0, from: 0, to: STEPS[0].to, expect: STEPS[0].expect });
check("a later step starts where the one before ended", stepAt("graphics").from, STEPS[1].to);
check("an unknown step", stepAt("dance"), null);

// ── The lines ──
check("seconds", elapsedText(7400), "7 s");
check("never negative", elapsedText(-5), "0 s");
check("a minute on", elapsedText(65_000), "1 min 05 s");
check("download with a size", downloadText(4.2 * 1048576, 13.2 * 1048576), "Downloading the engine: 4.2 / 13.2 MB");
check("download past the size", downloadText(14 * 1048576, 13 * 1048576), "Downloading the engine: 13.0 / 13.0 MB");
check("download without a size", downloadText(3 * 1048576, 0), "Downloading the engine: 3.0 MB");

// ── The wasm's size ──
const headers = (h) => ({ get: (n) => h[n] ?? null });
check("the built size wins", wasmSize(headers({ "Content-Length": "100" }), 500), 500);
check("plain response", wasmSize(headers({ "Content-Length": "13822426" }), 0), 13822426);
check("gzip: Content-Length is the compressed size", wasmSize(headers({ "Content-Encoding": "gzip", "Content-Length": "3928200" }), 0), 0);
check("no headers", wasmSize(headers({}), 0), 0);

// ── fetchWasm counts every byte and hands them on untouched ──
const bytes = new Uint8Array(3000).map((_, i) => i & 0xff);
const fakeFetch = async (url) => {
    if (String(url).endsWith("osiris_size.json")) return new Response(JSON.stringify({ bytes: 3000 }));
    const body = new ReadableStream({
        start(c) {
            for (let i = 0; i < 3; i++) c.enqueue(bytes.slice(i * 1000, (i + 1) * 1000));
            c.close();
        },
    });
    return new Response(body, { headers: { "Content-Encoding": "gzip" } });
};
const seen = [];
const response = await fetchWasm("http://x/pkg/osiris_bg.wasm", (done, total) => seen.push([done, total]), fakeFetch);
const got = new Uint8Array(await response.arrayBuffer());
check("progress", seen, [[0, 3000], [1000, 3000], [2000, 3000], [3000, 3000]]);
check("the wasm type, for streaming compile", response.headers.get("Content-Type"), "application/wasm");
check("same bytes", got.length === bytes.length && got.every((b, i) => b === bytes[i]), true);

if (failures > 0) {
    console.error("boot-test: " + failures + " failed");
    process.exit(1);
}
console.log("boot-test: OK");
