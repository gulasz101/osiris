// web/boot.js — what the page shows while it gets ready: the engine's download when the
// page opens, and the steps of the game's start after Enter.
//
// The functions here touch no page element, so web/tests/boot-test.mjs can run them in
// node. main.js draws what they return.

/**
 * The steps of the game's start, in order, as the game names them (`web::stage` in
 * web.rs). `to` is how far along the bar is once the step is done, in percent. The shares
 * follow where a start on an M1 spent its time in the smoke run's `stage ... at N ms` lines
 * (files 1.0 s, rules 5.1 s, graphics 0.3 s, menu 1.0 s);
 * `expect` is about how long the step takes there, in milliseconds, so the bar can keep
 * moving through a step without knowing when it ends.
 */
export const STEPS = [
    { name: "files", label: "Opening the game files", to: 14, expect: 1000 },
    { name: "rules", label: "Reading the buildings, people and rules", to: 82, expect: 5000 },
    { name: "graphics", label: "Preparing the graphics", to: 87, expect: 400 },
    { name: "menu", label: "Starting the intro and the main menu", to: 100, expect: 1000 },
];

/**
 * Where the bar stands for a step the game just entered.
 *
 * @param {string} name - the step the game named.
 * @returns {{index: number, from: number, to: number, expect: number} | null} the step's
 *   place in `STEPS`, the percent the bar starts it at and the percent it ends at, or null
 *   for a name this page does not know.
 */
export function stepAt(name) {
    const index = STEPS.findIndex((s) => s.name === name);
    if (index < 0) return null;
    const from = index === 0 ? 0 : STEPS[index - 1].to;
    return { index, from, to: STEPS[index].to, expect: STEPS[index].expect };
}

/**
 * How many whole seconds a wait has lasted, as the loading screen prints it.
 *
 * @param {number} ms - the time since Enter, in milliseconds.
 * @returns {string} `"7 s"`, or `"1 min 05 s"` from a minute on.
 */
export function elapsedText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + " s";
    return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
}

/**
 * The line under the boot bar while the engine downloads.
 *
 * @param {number} done - bytes so far.
 * @param {number} total - all the bytes, or 0 when the page does not know.
 * @returns {string} `"Downloading the engine: 4.2 / 13.2 MB"`.
 */
export function downloadText(done, total) {
    const mb = (n) => (n / (1024 * 1024)).toFixed(1);
    if (total > 0) return "Downloading the engine: " + mb(Math.min(done, total)) + " / " + mb(total) + " MB";
    return "Downloading the engine: " + mb(done) + " MB";
}

/**
 * How many bytes the wasm has once the browser has unpacked it. A server that sends it
 * compressed (GitHub Pages sends gzip) gives the compressed size in Content-Length, while
 * the bytes the page counts are the unpacked ones, so that header only counts when the
 * response is not compressed. `known` is the size the build wrote in `pkg/osiris_size.json`.
 *
 * @param {{get: (name: string) => string|null}} headers - the response's headers.
 * @param {number} known - the size from `osiris_size.json`, or 0.
 * @returns {number} the size, or 0 when there is no way to know it.
 */
export function wasmSize(headers, known) {
    if (known > 0) return known;
    const encoding = headers.get("Content-Encoding");
    if (encoding && encoding !== "identity") return 0;
    const length = Number(headers.get("Content-Length"));
    return Number.isFinite(length) && length > 0 ? length : 0;
}

/**
 * Fetch the wasm and count its bytes as they arrive. The bytes pass through untouched in a
 * new `Response` with the wasm type, so wasm-bindgen's `init` still compiles it while it
 * downloads (`WebAssembly.instantiateStreaming`).
 *
 * @param {string|URL} url - the wasm file.
 * @param {(done: number, total: number) => void} onProgress - called as bytes arrive.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Response>} the response to hand to `init`.
 */
export async function fetchWasm(url, onProgress, fetchImpl = fetch) {
    let known = 0;
    try {
        const sizeUrl = new URL("osiris_size.json", url);
        const r = await fetchImpl(sizeUrl, { cache: "no-cache" });
        if (r.ok) known = Number((await r.json()).bytes) || 0;
    } catch {
        // A build without the file still loads; the bar just has no end.
    }
    const response = await fetchImpl(url);
    if (!response.ok || !response.body) return response;
    const total = wasmSize(response.headers, known);
    let done = 0;
    onProgress(0, total);
    const counted = response.body.pipeThrough(
        new TransformStream({
            transform(chunk, controller) {
                done += chunk.byteLength;
                onProgress(done, total);
                controller.enqueue(chunk);
            },
        })
    );
    return new Response(counted, { headers: { "Content-Type": "application/wasm" } });
}
