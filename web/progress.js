// web/progress.js — the bar over the page while the game files are read, and the reads
// that feed it.
//
// The folder picker and drag and drop in main.js, and the copy in browser storage in
// opfs.js, all read their files through readAll, so every way of loading a Pharaoh
// folder shows the same bar and reads a few files at the same time.

/** How often the bar may be repainted, in milliseconds. */
export const INTERVAL_MS = 100;

/** How many files may be read at the same time. */
export const MAX_READS = 8;

/**
 * The line above the bar.
 *
 * @param {number} done - how many files have been read.
 * @param {number} total - how many files there are.
 * @returns {string} `Reading game files: 412 / 1335 (31%)`.
 */
export function progressText(done, total) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return "Reading game files: " + done + " / " + total + " (" + percent + "%)";
}

/**
 * The bar in the page: `show` puts it up, `update` repaints it at most every
 * `INTERVAL_MS`, and `finish` draws the last count and hides it. `now` is the clock, so
 * web/tests/progress-test.mjs can move it without waiting.
 *
 * @param {{hidden: boolean, querySelector: (selector: string) => any}} element - `#progress`.
 * @param {{now?: () => number}} [options]
 * @returns {{show: (total: number) => void, update: (done: number) => void,
 *   finish: (done?: number) => void, hide: () => void}}
 */
export function createBar(element, options = {}) {
    const now = options.now ?? (() => performance.now());
    const text = element.querySelector("#progress-text");
    const fill = element.querySelector("#progress-fill");
    let total = 0;
    let last = 0;

    const draw = (done) => {
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        if (text) text.textContent = progressText(done, total);
        if (fill) fill.style.width = percent + "%";
    };

    return {
        show(count) {
            total = count;
            last = now();
            draw(0);
            element.hidden = false;
        },
        update(done) {
            const at = now();
            if (at - last < INTERVAL_MS) return;
            last = at;
            draw(done);
        },
        finish(done) {
            draw(done ?? total);
            element.hidden = true;
        },
        hide() {
            element.hidden = true;
        },
    };
}

/**
 * Read `items` with `read`, hand each file's bytes to `take`, and keep the bar up to
 * date. At most `limit` reads are in flight at once. When one read fails the other
 * workers stop, so a half-read folder is never mounted and the page can say what went
 * wrong.
 *
 * `Blob.arrayBuffer()` rejects rather than throwing when a file cannot be read (MDN,
 * `Blob.arrayBuffer`), so a failure reaches the `catch` in `main.js` the same way it did
 * when the files were read one at a time.
 *
 * @param {Array<any>} items - the files to read, in the order they are handed out.
 * @param {(item: any) => Promise<ArrayBuffer|Uint8Array>} read - the bytes of one item.
 * @param {(item: any, bytes: ArrayBuffer|Uint8Array) => void} take - where the bytes go.
 * @param {ReturnType<typeof createBar>|null} [bar] - the progress bar, if there is one.
 * @param {number} [limit] - how many reads may be in flight, `MAX_READS` by default.
 * @returns {Promise<number>} how many files were read.
 */
export async function readAll(items, read, take, bar = null, limit = MAX_READS) {
    const total = items.length;
    let next = 0;
    let done = 0;
    let failed = false;
    if (bar) bar.show(total);
    // At least one worker, or nothing would ever be read from an empty list.
    const workers = Math.max(1, Math.min(limit, total));

    const worker = async () => {
        while (!failed && next < total) {
            const index = next;
            next += 1;
            const bytes = await read(items[index]);
            // A read that finished after another one failed must not be mounted.
            if (failed) return;
            take(items[index], bytes);
            done += 1;
            if (bar) bar.update(done);
        }
    };

    try {
        await Promise.all(Array.from({ length: workers }, () => worker()));
    } catch (err) {
        failed = true;
        throw err;
    } finally {
        if (bar) bar.finish(done);
    }
    return done;
}
