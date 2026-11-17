// Unit test for the Saves panel's parts that do not need a browser: the browser storage
// record `{ bytes, at }` in web/store.js (here) and the row helpers in web/saves.js.
// Every byte below is made up. Run with `node web/tests/saves-test.mjs`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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

if (failures > 0) {
    console.error("saves-test: " + failures + " failed");
    process.exit(1);
}
console.log("saves-test: OK");
