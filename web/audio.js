// web/audio.js — keep the game's audio context alive (browser only).
// Loaded as a classic <script> before main.js so the wrapper is in place before the wasm
// build (rodio through cpal's WebAudio host) creates its AudioContext.

(function () {
  "use strict";

  // Browsers keep an AudioContext suspended until the page has seen a user gesture, and the
  // gesture can be spent by the time the game has read a whole Pharaoh folder. So remember
  // every context the game creates and resume them on the next click, key press or touch.
  var Real = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Real) return;

  var contexts = [];

  class OsirisAudioContext extends Real {
    constructor(options) {
      super(options);
      contexts.push(this);
    }
  }

  globalThis.AudioContext = OsirisAudioContext;
  if (globalThis.webkitAudioContext) globalThis.webkitAudioContext = OsirisAudioContext;

  function resumeAll() {
    for (var i = 0; i < contexts.length; i++) {
      var ctx = contexts[i];
      if (ctx.state === "running" || ctx.state === "closed") continue;
      // resume() rejects if the context was closed in the meantime; that is not an error here.
      var p = ctx.resume();
      if (p && typeof p.catch === "function") p.catch(function () {});
    }
  }

  var events = ["pointerdown", "keydown", "touchend"];
  for (var e = 0; e < events.length; e++) {
    addEventListener(events[e], resumeAll, { capture: true });
  }

  /** The state of the newest context: "running", "suspended", "closed" or "none". */
  function state() {
    return contexts.length ? contexts[contexts.length - 1].state : "none";
  }

  globalThis.osirisAudio = { state: state, resumeAll: resumeAll };
})();
