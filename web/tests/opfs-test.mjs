// Unit test for the origin-private-file-system helpers in web/opfs.js. No browser and no
// game data: an in-memory stand-in for the OPFS folder handle stands in for the browser's,
// and every byte below is made up. Run with `node web/tests/opfs-test.mjs`.

import { hasMarker, readTree, removeTree, skipFile, writeTree } from "../opfs.js";

let failures = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error("FAIL: " + name + ": got " + a + ", want " + e);
        failures += 1;
    }
}

function checkTrue(name, actual) {
    if (!actual) {
        console.error("FAIL: " + name);
        failures += 1;
    }
}

function notFound(name) {
    const err = new Error(name + " not found");
    err.name = "NotFoundError";
    return err;
}

/** One file handle: a writable stream that keeps the bytes, and a Blob to read them. */
class FakeFile {
    constructor(name) {
        this.name = name;
        this.kind = "file";
        this.bytes = new Uint8Array(0);
    }

    async createWritable() {
        const file = this;
        return {
            async write(chunk) {
                const data = typeof chunk === "string"
                    ? new TextEncoder().encode(chunk)
                    : new Uint8Array(chunk);
                file.bytes = data;
            },
            async close() {},
        };
    }

    async getFile() {
        return new Blob([this.bytes]);
    }
}

/** One folder handle, the subset of FileSystemDirectoryHandle that web/opfs.js uses. */
class FakeDir {
    constructor(name) {
        this.name = name;
        this.kind = "directory";
        this.children = new Map();
    }

    async getDirectoryHandle(name, options = {}) {
        const found = this.children.get(name);
        if (found instanceof FakeDir) return found;
        if (found) throw new TypeError(name + " is a file");
        if (!options.create) throw notFound(name);
        const dir = new FakeDir(name);
        this.children.set(name, dir);
        return dir;
    }

    async getFileHandle(name, options = {}) {
        const found = this.children.get(name);
        if (found instanceof FakeFile) return found;
        if (found) throw new TypeError(name + " is a folder");
        if (!options.create) throw notFound(name);
        const file = new FakeFile(name);
        this.children.set(name, file);
        return file;
    }

    async removeEntry(name, options = {}) {
        const found = this.children.get(name);
        if (!found) throw notFound(name);
        if (found instanceof FakeDir && found.children.size > 0 && !options.recursive) {
            const err = new Error(name + " is not empty");
            err.name = "InvalidModificationError";
            throw err;
        }
        this.children.delete(name);
    }

    async *entries() {
        for (const [name, child] of this.children) yield [name, child];
    }
}

/** A `{ path, file }` entry holding made-up bytes; `text` keeps the test readable. */
function entry(path, text) {
    return { path, file: new Blob([text ?? path]) };
}

// ── The skip rule ───────────────────────────────────────────────────
const skipped = [".pdf", ".zip", ".dll", ".asi", ".m3d", ".tsk"];
for (const ext of skipped) {
    checkTrue("skip " + ext, skipFile("extras/manual" + ext));
    checkTrue("skip " + ext + " in upper case", skipFile("EXTRAS/MANUAL" + ext.toUpperCase()));
}
for (const path of ["Data/Pharaoh_General.sg3", "AUDIO/Wavs/a.wav", "readme.pdfx", "x.tsk.txt"]) {
    check("keep " + path, skipFile(path), false);
}

// ── Writing a tree ─────────────────────────────────────────────────
const root = new FakeDir("");
const game = await root.getDirectoryHandle("game", { create: true });
const list = [
    entry("Data/Pharaoh_General.sg3", "sg3"),
    entry("Data/Pharaoh_Text.eng", "eng"),
    entry("AUDIO/Wavs/a.wav", "wav"),
    entry("extras/manual.pdf", "pdf"),
    entry("patch.zip", "zip"),
];
const progress = [];
const written = await writeTree(game, list, { onProgress: (n, total) => progress.push(n + "/" + total) });
check("files written", written, 3);
check("progress counts the files that are kept", progress[progress.length - 1], "3/3");

const data = await game.getDirectoryHandle("Data");
const nested = await data.getFileHandle("Pharaoh_General.sg3");
check("nested file kept its bytes", new TextDecoder().decode(nested.bytes), "sg3");
checkTrue("no folder for the manual", !(await game.getDirectoryHandle("extras").catch(() => null)));
checkTrue("no zip at the top", !(await game.getFileHandle("patch.zip").catch(() => null)));

// ── The marker ─────────────────────────────────────────────────────
check("no marker before the copy finished", await hasMarker(game), false);
await writeTree(game, [entry(".complete", "3")]);
check("marker after the copy finished", await hasMarker(game), true);

// ── Reading it back ────────────────────────────────────────────────
const handed = [];
const read = await readTree(game, (path, file) => handed.push([path, file]));
const back = [];
for (const [path, file] of handed) {
    back.push([path, new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()))]);
}
back.sort();
check("files read back", read, 3);
check("paths and bytes read back", back, [
    ["AUDIO/Wavs/a.wav", "wav"],
    ["Data/Pharaoh_General.sg3", "sg3"],
    ["Data/Pharaoh_Text.eng", "eng"],
]);

// ── Forgetting ────────────────────────────────────────────────────
check("forget removes the folder", await removeTree(root), true);
check("nothing left over", [...root.children.keys()], []);
check("forgetting again is not an error", await removeTree(root), false);

if (failures > 0) {
    console.error("opfs-test: " + failures + " failed");
    process.exit(1);
}
console.log("opfs-test: OK");
