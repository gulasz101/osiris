// web/store.js — IndexedDB persistence for user files (browser only).
// Loaded as a classic <script> before main.js so wasm imports find osirisStore.

(function () {
  "use strict";

  /** @type {IDBDatabase | null} */
  var db = null;

  // Chain promise for serialising put / del operations.
  var chain = Promise.resolve();

  function open() {
    if (db) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("osiris", 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("user")) {
          d.createObjectStore("user");
        }
      };
      req.onsuccess = function () {
        db = req.result;
        resolve();
      };
      req.onerror = function () {
        console.error("osiris store: open failed", req.error);
        reject(req.error);
      };
    });
  }

  // Each `/user` file is kept as `{ bytes, at }`: the bytes and when they were written.
  // A page from before the Saves panel stored the bare ArrayBuffer or Uint8Array, and those
  // are still read; they simply have no time.

  /** The bytes of a stored value, whichever shape it has. */
  function bytesOf(value) {
    var bytes = value && value.bytes !== undefined ? value.bytes : value;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    return bytes;
  }

  /** When a stored value was written, in `Date.now()` milliseconds; 0 when it has no time. */
  function atOf(value) {
    return value && typeof value.at === "number" ? value.at : 0;
  }

  /** Every stored `[path, value]` pair, in the store's own order. */
  function readAll() {
    if (!db) return Promise.resolve([]);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("user", "readonly");
      var store = tx.objectStore("user");

      var keysDone = false, valsDone = false;
      var keysResult = null, valsResult = null;
      var err = null;

      var kreq = store.getAllKeys();
      kreq.onsuccess = function () { keysResult = kreq.result; keysDone = true; tryDone(); };
      kreq.onerror = function () { err = kreq.error; keysDone = true; tryDone(); };

      var vreq = store.getAll();
      vreq.onsuccess = function () { valsResult = vreq.result; valsDone = true; tryDone(); };
      vreq.onerror = function () { err = vreq.error; valsDone = true; tryDone(); };

      function tryDone() {
        if (err) { console.error("osiris store: loadAll failed", err); reject(err); return; }
        if (!keysDone || !valsDone) return;
        var out = [];
        for (var i = 0; i < keysResult.length; i++) {
          out.push([String(keysResult[i]), valsResult[i]]);
        }
        resolve(out);
      }
    });
  }

  /** @returns {Promise<[string, Uint8Array][]>} */
  function loadAll() {
    return readAll().then(function (pairs) {
      return pairs.map(function (pair) { return [pair[0], bytesOf(pair[1])]; });
    });
  }

  /**
   * When each stored file was written, for the Saves panel's date column.
   *
   * @returns {Promise<Object<string, number>>} path to `Date.now()` milliseconds; a file
   * written by an older page is left out and the panel shows no date for it.
   */
  function dates() {
    return readAll().then(function (pairs) {
      var out = {};
      for (var i = 0; i < pairs.length; i++) {
        var at = atOf(pairs[i][1]);
        if (at > 0) out[pairs[i][0]] = at;
      }
      return out;
    });
  }

  function put(path, bytes) {
    var copy = bytes.slice ? bytes.slice() : new Uint8Array(bytes);
    chain = chain.then(function () {
      if (!db) return Promise.reject(new Error("store not open"));
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("user", "readwrite");
        var store = tx.objectStore("user");
        var req = store.put({ bytes: copy, at: Date.now() }, path);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () {
          console.error("osiris store: put failed", req.error);
          reject(req.error);
        };
      });
    });
    return chain;
  }

  function del(path) {
    chain = chain.then(function () {
      if (!db) return Promise.reject(new Error("store not open"));
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("user", "readwrite");
        var store = tx.objectStore("user");
        var req = store.delete(path);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () {
          console.error("osiris store: del failed", req.error);
          reject(req.error);
        };
      });
    });
    return chain;
  }

  /** @returns {Promise<void>} */
  function idle() {
    return chain.catch(function () {});
  }

  globalThis.osirisStore = {
    open: open,
    loadAll: loadAll,
    dates: dates,
    put: put,
    del: del,
    idle: idle,
  };
})();
