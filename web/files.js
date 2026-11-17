// web/files.js — the game files the page has registered, and the one place that reads
// their bytes.
//
// The page never copies the whole install into wasm memory. It keeps each picked or
// restored file as the browser's own `File` (which sits on disk) and tells the file store
// its path and size; the game's read of that path comes here and only this file's bytes
// are copied into wasm. Nothing is cached: a file the game reads twice is read twice, so
// the memory a session holds stays what the game is using (the `web-lazy` change).
//
// The read has to be synchronous: `osiris_vfs::read` hands the bytes back at once and the
// game runs on the page's main thread. `FileReaderSync` and `FileSystemSyncAccessHandle`
// exist only in Web Workers, so what is left here is a synchronous `XMLHttpRequest` for
// the file's `blob:` URL. Chromium logs a warning about that, which is expected.

/** VFS path as the file store holds it (e.g. `/PharaohData/Data/x.sg3`) -> the file. */
const files = new Map();

/**
 * Tell the store that `vfsPath` holds `file`, without reading it. The URL the read uses
 * is made here, once, because making it per read would leak one per read.
 *
 * @param {string} vfsPath - the path as the file store holds it, with a leading "/".
 * @param {File|Blob} file - the file the browser already has on disk.
 */
export function register(vfsPath, file) {
    const old = files.get(vfsPath);
    if (old) URL.revokeObjectURL(old.url);
    files.set(vfsPath, { file, url: URL.createObjectURL(file) });
}

/**
 * Forgets every registered file, and the URLs they hold.
 */
export function clear() {
    for (const entry of files.values()) URL.revokeObjectURL(entry.url);
    files.clear();
}

/**
 * Read one registered file's bytes, synchronously, on the main thread.
 *
 * A `blob:` URL answers with status 200. Anything else, or a throw from the request, is a
 * failed read, and the error names the path so a missing file shows up in the console.
 *
 * @param {string} vfsPath - the path as the file store holds it.
 * @returns {Uint8Array} the file's exact bytes.
 */
export function read(vfsPath) {
    const entry = files.get(vfsPath);
    if (!entry) throw new Error("no game file registered at " + vfsPath);
    const request = new XMLHttpRequest();
    request.open("GET", entry.url, false);
    // A synchronous request in a window may not set `responseType` (the browser throws
    // InvalidAccessError), so ask for the bytes one character each instead: every
    // character of `responseText` is then one byte of the file, 0 to 255.
    request.overrideMimeType("text/plain; charset=x-user-defined");
    request.send();
    if (request.status !== 200) {
        throw new Error("reading " + vfsPath + " failed with status " + request.status);
    }
    const text = request.responseText;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
}

/**
 * How many files the page has registered.
 *
 * @returns {number}
 */
export function count() {
    return files.size;
}

/**
 * How many bytes the registered files hold, for the page's "indexed N files (X MB)" line.
 *
 * @returns {number}
 */
export function totalSize() {
    let total = 0;
    for (const entry of files.values()) total += entry.file.size;
    return total;
}

// wasm asks here: `osiris_vfs`'s lazy reader calls `osirisFiles.read` (web.rs).
globalThis.osirisFiles = { read, register, clear, count, totalSize };
