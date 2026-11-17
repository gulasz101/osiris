// Unit test for the Saves panel's parts that do not need a browser: the browser storage
// record `{ bytes, at }` in web/store.js (here) and the row helpers in web/saves.js.
// Every byte below is made up. Run with `node web/tests/saves-test.mjs`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { MAX_SAVE_BYTES, download, formatDate, formatSize, saveName, tooBig } from "../saves.js";

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

// ── The browser storage record ─────────────────────────────────────
//
// web/store.js is a classic <script> that hands its functions over on `globalThis`, so the
// test runs its own source in a sandbox holding a stand-in for IndexedDB. The host's
// `ArrayBuffer` and `Uint8Array` are handed in as well, so the `instanceof` in the store
// checks the same constructors the test builds its values with.

/** One object store of the stand-in database: a Map that answers requests a tick later. */
class FakeStore {
    constructor(data) {
        this.data = data;
    }

    /** A request whose `onsuccess` runs on the next microtask, like IndexedDB's. */
    request(fill) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
            fill(req);
            if (req.onsuccess) req.onsuccess();
        });
        return req;
    }

    getAllKeys() {
        return this.request((req) => { req.result = [...this.data.keys()]; });
    }

    getAll() {
        return this.request((req) => { req.result = [...this.data.values()]; });
    }

    put(value, key) {
        return this.request((req) => { this.data.set(key, value); req.result = key; });
    }

    delete(key) {
        return this.request((req) => { this.data.delete(key); });
    }
}

/** The `indexedDB` global store.js expects: one database with a `user` object store. */
function fakeIndexedDB(data) {
    return {
        open() {
            const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                req.result = {
                    objectStoreNames: { contains: (name) => name === "user" },
                    createObjectStore: () => {},
                    transaction: () => ({ objectStore: () => new FakeStore(data) }),
                };
                if (req.onsuccess) req.onsuccess();
            });
            return req;
        },
    };
}

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "store.js"), "utf8");

/** Load web/store.js over a database holding `data`, and return its `osirisStore`. */
function loadStore(data) {
    const sandbox = {
        indexedDB: fakeIndexedDB(data),
        console: { log: () => {}, warn: () => {}, error: () => {} },
        ArrayBuffer,
        Uint8Array,
        Date,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: "store.js" });
    return sandbox.osirisStore;
}

const SAVE = "/user/families/smoke/saves/Nubt.osiris";
const SETTINGS = "/user/rules.toml";
const OLD_SAVE = "/user/saves/Old.osiris";

// Two shapes in the same store: this page's records, and the plain values an older visit
// wrote (one ArrayBuffer, one Uint8Array, since both were stored before).
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const settings = new TextEncoder().encode("x = 1\n");
const oldBytes = new Uint8Array([9, 9, 9]);
const at = Date.UTC(2026, 10, 17, 10, 4);
const data = new Map([
    [SAVE, { bytes, at }],
    [SETTINGS, settings],
    [OLD_SAVE, oldBytes.buffer],
]);

const store = loadStore(data);
await store.open();

const loaded = await store.loadAll();
check("every stored file comes back, plain and record alike", loaded.length, 3);
check("a record's bytes", [...loaded[0][1]], [...bytes]);
check("a plain Uint8Array's bytes", [...loaded[1][1]], [...settings]);
check("a plain ArrayBuffer's bytes", [...loaded[2][1]], [...oldBytes]);
checkTrue("the bytes are a Uint8Array", loaded[0][1] instanceof Uint8Array);

const dates = await store.dates();
check("a record has its write time", dates[SAVE], at);
checkTrue("a plain value has no time", !(OLD_SAVE in dates));
check("only the record has a time, the older files are left out",
    Object.keys(dates).sort(), [SAVE]);

// A write from the game lands as a record with the moment it arrived.
const written = new Uint8Array([42, 43]);
await store.put(SETTINGS, written);
const record = data.get(SETTINGS);
checkTrue("put writes a record", !!record && record.bytes instanceof Uint8Array);
check("put keeps the bytes", [...record.bytes], [...written]);
checkTrue("put records the time", typeof record.at === "number" && Date.now() - record.at < 60000);
check("the record's time reaches the panel", (await store.dates())[SETTINGS], record.at);

// And a delete goes through to the store.
await store.del(SAVE);
checkTrue("delete removes the file", !data.has(SAVE));
check("the list after the delete", (await store.loadAll()).map(([path]) => path).sort(),
    [OLD_SAVE, SETTINGS].sort());

// ── The row helpers ────────────────────────────────────────────────

check("a few hundred bytes", formatSize(812), "812 B");
check("nothing", formatSize(0), "0 B");
check("a whole kilobyte", formatSize(1024), "1.0 kB");
check("the design's example", formatSize(188723), "184.3 kB");
check("a few megabytes", formatSize(3 * 1024 * 1024), "3.0 MB");

// A local time, built from local parts, so the test does not care about the time zone.
const at2 = new Date(2026, 10, 17, 10, 4).getTime();
check("the design's date", formatDate(at2), "2026-11-17 10:04");
check("a single-digit month and hour keep their zero", formatDate(new Date(2026, 0, 5, 9, 7).getTime()),
    "2026-01-05 09:07");
check("no time", formatDate(undefined), "—");
check("a zero time", formatDate(0), "—");
check("a nonsense time", formatDate(NaN), "—");

check("a plain name", saveName("Nubt.osiris"), "Nubt.osiris");
check("a name with spaces around it", saveName("  Nubt.osiris "), "Nubt.osiris");
check("a name climbing out", saveName("../Nubt.osiris"), null);
check("a name inside a path", saveName("sub/Nubt.osiris"), null);
check("a Windows path", saveName("sub\\Nubt.osiris"), null);
check("a name with a dot-dot run", saveName("a..b.osiris"), null);
check("an empty name", saveName(""), null);
check("no name at all", saveName(null), null);

check("a small file", tooBig(4096), false);
check("exactly twenty megabytes", tooBig(MAX_SAVE_BYTES), false);
check("a byte over", tooBig(MAX_SAVE_BYTES + 1), true);

// ── The download, over fakes ──────────────────

/** A `document` that records the `<a>` it makes, and a `URL` that records both calls. */
function fakes() {
    const appended = [];
    const links = [];
    const created = [];
    const revoked = [];
    const document = {
        body: { appendChild: (el) => appended.push(el) },
        createElement(tag) {
            const link = {
                tag,
                href: "",
                download: "",
                hidden: false,
                clicks: 0,
                click() { this.clicks += 1; },
                remove() {
                    const i = appended.indexOf(this);
                    if (i >= 0) appended.splice(i, 1);
                },
            };
            links.push(link);
            return link;
        },
    };
    const url = {
        createObjectURL(blob) { created.push(blob); return "blob:osiris-" + created.length; },
        revokeObjectURL(href) { revoked.push(href); },
    };
    return { document, url, appended, links, created, revoked };
}

const fake = fakes();
const blob = new Blob(["a save"]);
const href = download(blob, "Nubt.osiris", { document: fake.document, url: fake.url, delay: 0 });
check("one link made", fake.links.length, 1);
check("the link is an anchor", fake.links[0].tag, "a");
check("the link carries the object URL", fake.links[0].href, href);
check("the link is named after the save", fake.links[0].download, "Nubt.osiris");
checkTrue("the blob is the one handed over", fake.created[0] === blob);
check("the link is clicked once", fake.links[0].clicks, 1);
check("the link is not left on the page", fake.appended.length, 0);
check("the URL is not released before the browser starts", fake.revoked, []);
await new Promise((resolve) => setTimeout(resolve, 5));
check("the URL is released once the download started", fake.revoked, [href]);

if (failures > 0) {
    console.error("saves-test: " + failures + " failed");
    process.exit(1);
}
console.log("saves-test: OK");
