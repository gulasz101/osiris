/**
 * Helpers for turning a file input or drag-and-drop into a flat list of
 * [{ path, file }] entries relative to the folder root.
 */

/** Name that marks the game root, below the folder that holds `Data/`. */
const GAME_FILE = "data/pharaoh_general.sg3";

/** Separators to one "/", so a path from any walker compares the same way. */
function normalisePath(path) {
    return String(path).replace(/\\/g, "/");
}

/**
 * Find the game root inside the paths the player chose: the shortest directory
 * prefix `P` for which `P + "Data/Pharaoh_General.sg3"` is one of the paths.
 *
 * Names are compared case-insensitively, as the game's own files are spelled
 * differently between installs. The prefix is returned with its trailing "/",
 * or as `""` when the chosen folder itself holds `Data/`.
 *
 * @param {Array<{path: string, file: File|Blob}>} list
 * @returns {string|null} the root prefix, or null when there is no Pharaoh folder.
 */
export function findGameRoot(list) {
    let root = null;
    for (const entry of list) {
        const path = normalisePath(entry.path).toLowerCase();
        if (!path.endsWith(GAME_FILE)) continue;
        // "Data/Pharaoh_General.sg3" must start a path part, not end another one
        // ("myData/..." is not the root's "Data/...").
        const prefix = path.slice(0, path.length - GAME_FILE.length);
        if (prefix !== "" && !prefix.endsWith("/")) continue;
        const found = normalisePath(entry.path).slice(0, prefix.length);
        if (root === null || found.length < root.length) {
            root = found;
        }
    }
    return root;
}

/**
 * Keep only the entries under `root`, with the root prefix removed, so a file at
 * `Akhenaten/resources/Data/x.sg3` comes out as `Data/x.sg3` when the root is
 * `Akhenaten/resources/`. Entries outside the root (a zip, `extras/`, a Linux
 * launcher) are dropped before anything is read.
 *
 * @param {string|null} root - as returned by findGameRoot ("" for the chosen folder).
 * @param {Array<{path: string, file: File|Blob}>} list
 * @returns {Array<{path: string, file: File|Blob}>}
 */
export function filesUnder(root, list) {
    const out = [];
    // No root found: the page refuses the folder, so no file is under it.
    if (root === null || root === undefined) return out;
    for (const entry of list) {
        const path = normalisePath(entry.path);
        if (root !== "") {
            if (path.slice(0, root.length).toLowerCase() !== root.toLowerCase()) continue;
        }
        out.push({ path: path.slice(root.length), file: entry.file });
    }
    return out;
}

/**
 * Convert a FileList (from an <input type="file" webkitdirectory>) into
 * [{ path, file }], stripping the first path component from each entry so
 * that the paths are relative to the folder the player chose.
 */
export function filesFromInput(fileList) {
    const out = [];
    for (const file of fileList) {
        let rel = file.webkitRelativePath || file.name;
        // Strip everything up to and including the first slash.
        const idx = rel.indexOf("/");
        if (idx !== -1) {
            rel = rel.slice(idx + 1);
        }
        out.push({ path: rel, file });
    }
    return out;
}

/**
 * Convert a drag-and-drop's DataTransfer into [{ path, file }] using the
 * File and Directory Entries API (webkitGetAsEntry).
 */
export async function filesFromDrop(dataTransfer) {
    // Grab items synchronously — the list is invalidated after the first await.
    const items = [...dataTransfer.items];
    if (items.length === 0) {
        // Fallback: treat as plain files.
        return [...dataTransfer.files].map(f => ({ path: f.name, file: f }));
    }

    const entries = items.map(i => i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length === 0) {
        // Fallback to files.
        return [...dataTransfer.files].map(f => ({ path: f.name, file: f }));
    }

    // If exactly one entry and it is a directory, read its children directly
    // so the folder name itself does not appear in paths (same as file input).
    if (entries.length === 1 && entries[0].isDirectory) {
        const dir = /** @type {FileSystemDirectoryEntry} */ (entries[0]);
        const reader = dir.createReader();
        let allEntries = [];
        while (true) {
            const batch = await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
            if (batch.length === 0) break;
            allEntries = allEntries.concat(batch);
        }
        // Walk each child with no prefix so the folder name is not in path.
        const result = [];
        for (const child of allEntries) {
            const sub = await walk(child, "");
            result.push(...sub);
        }
        return result;
    }

    // Otherwise walk every top-level entry.
    const result = [];
    for (const entry of entries) {
        const sub = await walk(entry, "");
        result.push(...sub);
    }
    return result;
}

/**
 * Recursively walk a FileSystemEntry and return [{ path, file }].
 * @param {FileSystemEntry} entry  - the entry to walk.
 * @param {string} prefix          - path prefix (caller supplies trailing "/" if needed).
 * @returns {Promise<Array<{path: string, file: File|Blob}>>}
 */
export async function walk(entry, prefix) {
    const out = [];

    if (entry.isFile) {
        const fileEntry = /** @type {FileSystemFileEntry} */ (entry);
        const file = await new Promise((resolve, reject) => {
            fileEntry.file(resolve, reject);
        });
        out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
        const dirEntry = /** @type {FileSystemDirectoryEntry} */ (entry);
        // Create ONE reader and call readEntries in a loop until empty.
        const reader = dirEntry.createReader();
        let allEntries = [];

        while (true) {
            const batch = await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
            if (batch.length === 0) break;
            allEntries = allEntries.concat(batch);
        }

        // Walk each child.
        for (const child of allEntries) {
            const sub = await walk(child, prefix + entry.name + "/");
            out.push(...sub);
        }
    }

    return out;
}
