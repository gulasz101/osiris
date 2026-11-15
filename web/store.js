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

  /** @returns {Promise<[string, Uint8Array][]>} */
  function loadAll() {
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
          var key = String(keysResult[i]);
          var val = valsResult[i];
          if (val instanceof ArrayBuffer) {
            out.push([key, new Uint8Array(val)]);
          } else {
            out.push([key, val]);
          }
        }
        resolve(out);
      }
    });
  }

  function put(path, bytes) {
    var copy = bytes.slice ? bytes.slice() : new Uint8Array(bytes);
    chain = chain.then(function () {
      if (!db) return Promise.reject(new Error("store not open"));
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("user", "readwrite");
        var store = tx.objectStore("user");
        var req = store.put(copy, path);
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

  globalThis.osirisStore = { open: open, loadAll: loadAll, put: put, del: del, idle: idle };
})();
