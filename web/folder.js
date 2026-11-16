/**
 * Helpers for turning a file input or drag-and-drop into a flat list of
 * [{ path, file }] entries relative to the folder root.
 */

/**
 * Convert a FileList (from an <input type="file" webkitdirectory>) into
 * [{ path, file }], stripping the first path component from each entry so
 * that mount_file receives paths relative to the chosen folder.
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

    // If exactly one entry and it is a directory, walk it with no prefix
    // (the dropped folder itself is the root).
    if (entries.length === 1 && entries[0].isDirectory) {
        return walk(entries[0], "");
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
