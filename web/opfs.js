// web/opfs.js — keep the player's game files in the browser's origin private file
// system, so a reload does not ask for the folder again.
//
// Imported by main.js; nothing here touches the IndexedDB saves in store.js. The tree
// helpers take a FileSystemDirectoryHandle, so web/tests/opfs-test.mjs can drive them
// with an in-memory folder in Node.

/** The folder under the OPFS root that holds the game files. */
const GAME_DIR = "game";

/** Marker file, written last: only then is the copy complete. */
const MARKER = ".complete";

/**
 * Extensions of files the engine never reads: the manual, the archives, the Windows
 * shims and the mission editor's leftovers.
 */
const SKIP = [".pdf", ".zip", ".dll", ".asi", ".m3d", ".tsk"];

/**
 * Whether a game file is one the page does not store.
 *
 * @param {string} path - a path relative to the game root.
 * @returns {boolean}
 */
export function skipFile(path) {
    const lower = String(path).toLowerCase();
    return SKIP.some(ext => lower.endsWith(ext));
}

/** A path split into the names of its folders and its file name, with no empty parts. */
function names(path) {
    return String(path)
        .replace(/\\/g, "/")
        .split("/")
        .filter(part => part !== "" && part !== "." && part !== "..");
}

/**
 * Write every file of `list` under `dir`, keeping each file's path. A file the engine
 * never reads (see `skipFile`) is neither written nor counted.
 *
 * @param {FileSystemDirectoryHandle} dir - the `game/` folder.
 * @param {Array<{path: string, file: Blob}>} list
 * @param {{onProgress?: (written: number, total: number) => void}} [options]
 * @returns {Promise<number>} how many files were written.
 */
export async function writeTree(dir, list, options = {}) {
    const total = list.filter(entry => !skipFile(entry.path)).length;
    let written = 0;
    for (const entry of list) {
        if (skipFile(entry.path)) continue;
        const parts = names(entry.path);
        if (parts.length === 0) continue;
        let parent = dir;
        for (const folder of parts.slice(0, -1)) {
            parent = await parent.getDirectoryHandle(folder, { create: true });
        }
        const handle = await parent.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await handle.createWritable();
        try {
            await writable.write(new Uint8Array(await entry.file.arrayBuffer()));
        } finally {
            await writable.close();
        }
        written += 1;
        if (options.onProgress) options.onProgress(written, total);
    }
    return written;
}

/**
 * Read every file under `dir` and hand it to `onFile`, one at a time so only one file's
 * bytes are in memory. The marker file is left out.
 *
 * @param {FileSystemDirectoryHandle} dir - the `game/` folder.
 * @param {(path: string, bytes: Uint8Array) => void} onFile
 * @returns {Promise<number>} how many files were read.
 */
export async function readTree(dir, onFile) {
    let count = 0;
    const walk = async (folder, prefix) => {
        for await (const [name, handle] of folder.entries()) {
            const path = prefix + name;
            if (handle.kind === "directory") {
                await walk(handle, path + "/");
            } else if (path !== MARKER) {
                const file = await handle.getFile();
                onFile(path, new Uint8Array(await file.arrayBuffer()));
                count += 1;
            }
        }
    };
    await walk(dir, "");
    return count;
}

/**
 * Whether `dir` holds the marker that says the copy is complete.
 *
 * @param {FileSystemDirectoryHandle} dir
 * @returns {Promise<boolean>}
 */
export async function hasMarker(dir) {
    try {
        await dir.getFileHandle(MARKER);
        return true;
    } catch {
        return false;
    }
}

/**
 * Delete the whole `game/` folder, so a half copy can never be mistaken for a full one.
 *
 * @param {FileSystemDirectoryHandle} root - the OPFS root.
 * @returns {Promise<boolean>} whether a folder was removed.
 */
export async function removeTree(root) {
    try {
        await root.removeEntry(GAME_DIR, { recursive: true });
        return true;
    } catch {
        return false;
    }
}
