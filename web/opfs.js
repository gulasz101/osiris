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

/** The one warning a browser without enough storage gets; it never stops the game. */
const NO_STORAGE = "osiris web: the game files cannot be kept in browser storage";

/**
 * Whether this browser has the origin private file system at all.
 *
 * @returns {boolean}
 */
export function available() {
    return typeof navigator !== "undefined"
        && !!navigator.storage
        && typeof navigator.storage.getDirectory === "function";
}

/**
 * Copy the game files into `game/` in the origin private file system and mark the copy
 * complete. Called without `await` after the game has started, so the start is not
 * slower; every file is written one at a time so the game keeps drawing between them.
 *
 * A failure logs one warning and removes what was written, and the page then behaves as
 * it did before this existed: the player picks the folder on every load.
 *
 * @param {Array<{path: string, file: Blob}>} list - the files under the game root.
 * @returns {Promise<number>} how many files were stored, 0 when nothing was.
 */
export async function save(list) {
    if (!available()) {
        console.warn(NO_STORAGE + ": this browser has no origin private file system");
        return 0;
    }
    let root = null;
    try {
        // Ask once for storage the browser will not throw away on its own.
        await navigator.storage.persist().catch(() => false);

        // Say no before writing anything when the space clearly is not there.
        const needed = list
            .filter(entry => !skipFile(entry.path))
            .reduce((sum, entry) => sum + (entry.file.size || 0), 0);
        if (typeof navigator.storage.estimate === "function") {
            const estimate = await navigator.storage.estimate();
            const free = (estimate.quota || 0) - (estimate.usage || 0);
            if (estimate.quota > 0 && free < needed) {
                console.warn(NO_STORAGE + ": " + needed + " bytes needed, " + free + " free");
                return 0;
            }
        }

        root = await navigator.storage.getDirectory();
        const game = await root.getDirectoryHandle(GAME_DIR, { create: true });
        // An older copy must not look complete while this one is still being written.
        await game.removeEntry(MARKER).catch(() => {});

        const count = await writeTree(game, list, {
            onProgress: (written, total) => {
                if (written % 100 === 0 && written < total) {
                    console.log(
                        "osiris web: copied " + written + "/" + total + " game files to browser storage"
                    );
                }
            },
        });

        const marker = await game.getFileHandle(MARKER, { create: true });
        const writable = await marker.createWritable();
        await writable.write(String(count));
        await writable.close();

        console.log("osiris web: game files copied to browser storage (" + count + " files)");
        return count;
    } catch (err) {
        console.warn(NO_STORAGE + ": " + (err && err.message ? err.message : err));
        if (root) await removeTree(root);
        return 0;
    }
}

/**
 * Mount the game files a finished copy left behind, at `/PharaohData/<path>`, the place
 * `start_game` looks for them.
 *
 * @param {(vfsPath: string, bytes: Uint8Array) => void} mount - `mount_file` from main.js.
 * @returns {Promise<number>} how many files were mounted, 0 when there is no complete copy.
 */
export async function restore(mount) {
    if (!available()) return 0;
    try {
        const root = await navigator.storage.getDirectory();
        const game = await root.getDirectoryHandle(GAME_DIR);
        if (!(await hasMarker(game))) return 0;
        return await readTree(game, (path, bytes) => mount("PharaohData/" + path, bytes));
    } catch (err) {
        // A first visit has no `game/` folder at all, which is not worth a warning.
        if (!(err && err.name === "NotFoundError")) {
            console.warn("osiris web: could not read the game files from browser storage: "
                + (err && err.message ? err.message : err));
        }
        return 0;
    }
}

/**
 * Delete the stored game files, so the next load asks for the folder again.
 *
 * @returns {Promise<boolean>} whether a stored copy was removed.
 */
export async function forget() {
    if (!available()) return false;
    try {
        return await removeTree(await navigator.storage.getDirectory());
    } catch (err) {
        console.warn("osiris web: could not forget the stored game files: "
            + (err && err.message ? err.message : err));
        return false;
    }
}
