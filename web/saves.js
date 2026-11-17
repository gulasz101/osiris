// web/saves.js — the Saves panel's small pieces: how a size and a date read, the import's
// own name check, the 20 MB check, and the download itself.
//
// Nothing here touches the DOM unless it is handed one, so web/tests/saves-test.mjs drives
// the download with fakes and no browser is needed.

/**
 * The largest save the page imports: the same 20 MB as `MAX_SAVE_BYTES` in
 * `crates/osiris-app/src/saves.rs`, spelled here as well so the page does not read a huge
 * file into memory only to be told no by wasm.
 */
export const MAX_SAVE_BYTES = 20 * 1024 * 1024;

/**
 * A size in bytes as a player reads it: `812 B`, `184.3 kB`, `1.2 MB`.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " kB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * A write time as `2026-11-17 10:04`, in the browser's own clock, or `—` when the file has
 * no time (a save an older page wrote before the times were kept).
 *
 * @param {number|undefined} ms - `Date.now()` milliseconds.
 * @returns {string}
 */
export function formatDate(ms) {
    if (!ms) return "—";
    const date = new Date(Number(ms));
    if (Number.isNaN(date.getTime())) return "—";
    const pad = (n) => String(n).padStart(2, "0");
    return (
        date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
        " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
    );
}

/**
 * The name to import a chosen file under, or `null` when it is not a plain file name.
 *
 * Refusing `/`, `\` and `..` here means a file whose name is a path is refused before the
 * page reads a byte of it; `saves.rs` checks the same things again before writing.
 *
 * @param {string} name - `file.name` from the file input.
 * @returns {string|null}
 */
export function saveName(name) {
    const trimmed = String(name ?? "").trim();
    if (trimmed === "") return null;
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) return null;
    return trimmed;
}

/**
 * Whether an import is over [`MAX_SAVE_BYTES`].
 *
 * @param {number} size - the file's size in bytes.
 * @returns {boolean}
 */
export function tooBig(size) {
    return Number(size) > MAX_SAVE_BYTES;
}

/**
 * Hand `blob` to the browser as a download called `name`: an object URL on a temporary
 * `<a download>`, clicked once, then released.
 *
 * The URL is released a moment after the click rather than straight away, which is what MDN
 * warns about ("don't immediately revoke"): the browser needs it while the download starts.
 *
 * @param {Blob} blob
 * @param {string} name - the file name the browser saves it under.
 * @param {{document?: Document, url?: typeof URL, delay?: number}} [options]
 * @returns {string} the object URL, for a caller that wants to know it.
 */
export function download(blob, name, options = {}) {
    const doc = options.document || globalThis.document;
    const urls = options.url || globalThis.URL;
    const href = urls.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = href;
    link.download = name;
    link.hidden = true;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    globalThis.setTimeout(() => urls.revokeObjectURL(href), options.delay ?? 1000);
    return href;
}
