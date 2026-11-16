# Design: web-sound

Look up first, in docs-mcp: `cpal` 0.17.3 (hosts, `Stream::play`, feature `wasm-bindgen`),
`rodio` 0.22.2 (`DeviceSinkBuilder::open_default_sink`, `Decoder::builder`, `Player`),
`mdn-web-apis` (`AudioContext`, `AudioContext.resume()`, autoplay policy, user activation),
`wasm-bindgen`. The registry source is the ground truth:
`~/.cargo/registry/src/*/cpal-0.17.3` and `rodio-0.22.2`.

## Facts checked in the source
- rodio 0.22.2 has feature `wasm-bindgen = ["cpal/wasm-bindgen"]` (`rodio-0.22.2/Cargo.toml`).
  Default features (`playback`, `mp3`, `wav`, `vorbis`, `flac`, ...) stay on; the game needs mp3
  (music, ambience) and wav (effects, speech).
- cpal 0.17.3 compiles the WebAudio host only for
  `cfg(all(target_arch = "wasm32", feature = "wasm-bindgen"))`
  (`cpal-0.17.3/src/host/mod.rs`). Without the feature the default host is the null host:
  `open_default_sink()` fails and `Audio::new` returns `Audio { inner: None }`. That is the
  silence today. No `cfg` in `osiris-audio` disables audio on wasm.
- The WebAudio host makes the `AudioContext` inside `build_output_stream`
  (`host/webaudio/mod.rs`) and `Stream::play` calls `ctx.resume()`. It feeds the mixer from two
  `setTimeout` closures on the main thread. No thread is spawned, and cpal marks its types as
  safe because wasm is single threaded.
- rodio's `Player` and mixer use `Mutex` and channels only; they never block. `sleep_until_end`
  is the one blocking call, and `osiris-audio` does not call it (task 1.1 greps for it).
  `std::thread` appears in the app only in `movie.rs`, which is already stubbed on wasm.
- `osiris_vfs::Reader` is `std::io::Cursor<Arc<[u8]>>` on wasm and `BufReader<File>` on desktop.
  Both are `Read + Seek + Send + Sync + 'static`, which `rodio::Decoder::builder()` needs.
- `Decoder::try_from(File)` sets the byte length for seeking; with a reader the length is set by
  `.with_byte_len(osiris_vfs::len(path)?)`.

## osiris-audio changes
`Cargo.toml`:
```toml
[dependencies]
rodio = "0.22"
[target.'cfg(target_arch = "wasm32")'.dependencies]
rodio = { version = "0.22", features = ["wasm-bindgen"] }
```
`lib.rs` replaces the two file helpers; the type aliases follow the reader:
```rust
type FileDecoder = rodio::Decoder<osiris_vfs::Reader>;
type FileLoopedDecoder = rodio::decoder::LoopedDecoder<osiris_vfs::Reader>;
fn open_source(path: &Path) -> Result<FileDecoder>;        // Error::Io on open, Error::Decode on decode
fn open_looped_source(path: &Path) -> Result<FileLoopedDecoder>;
```
Use `osiris_vfs::open(path)` and `osiris_vfs::len(path)` (map errors to `Error::Io`, as now),
then `rodio::Decoder::builder().with_data(reader).with_byte_len(len).with_seekable(true).build()`.
For the looped one use `rodio::Decoder::new_looped(reader)` as now. No behaviour change on
desktop: the same bytes reach the same decoder.

## The user gesture
The click on the folder button (or the folder drop) starts `start_game`, which calls
`Audio::new` through `run` in `main.rs`. Chromium lets an `AudioContext` start after any
earlier click, but Firefox and Safari want the context created or resumed during a gesture, and
the gesture can be spent by the time many files are read. So `web/audio.js` does not rely on
timing:
```js
// classic script, runs before main.js
const Real = globalThis.AudioContext;
const contexts = [];
globalThis.AudioContext = class extends Real { constructor(o) { super(o); contexts.push(this); } };
for (const ev of ["pointerdown", "keydown", "touchend"])
    addEventListener(ev, () => contexts.forEach(c => c.state !== "running" && c.resume()), { capture: true });
globalThis.osirisAudio = { state: () => contexts.length ? contexts.at(-1).state : "none" };
```
`resume()` returns a promise; ignore a rejection (`.catch(() => {})`). Loaded by `index.html`
before `main.js`, after `store.js` if that change is in.

## Smoke test hooks (crates/osiris-app/src/web.rs)
```rust
thread_local! { static AUDIO: RefCell<Option<osiris_audio::Audio>> = ...; }
#[wasm_bindgen] pub fn debug_audio_open() -> bool; // Audio::new("/PharaohData"), keeps it; true if a device opened
#[wasm_bindgen] pub fn debug_audio_beep();         // mounts a generated 0.2 s 440 Hz WAV at
                                                    // /PharaohData/AUDIO/Wavs/osiris_beep.wav, then play_effect("osiris_beep.wav")
```
`Audio` needs a way to say whether it has a device: add `pub fn has_output(&self) -> bool`
(`self.inner.is_some()`). The WAV is built in code (44-byte header plus 16-bit samples); no game
file is involved.

## Smoke test (web/tests/smoke.mjs)
After `osiris web: ready`: `page.mouse.click` on the page, then `page.evaluate`: import
`./pkg/osiris.js`, `debug_audio_open()` must be `true`, call `debug_audio_beep()`, wait 300 ms,
`osirisAudio.state()` must be `"running"`. Else print `FAIL: no sound` and exit 1. On success
print `osiris web: sound OK`. Headless Chromium has a WebAudio output (a null sink); if
the run fails only because the machine has no audio device, the test prints `SKIP: no audio
device` and does not fail.

## Gotchas to keep in mind
- Mixing and mp3 decoding run on the main thread inside cpal's timer closure. A long mp3 start
  can stutter the picture; accept it now, measure later.
- cpal asks for the device's sample rate through the context; rodio resamples, nothing to do.
- Rodio's `recording` default feature pulls cpal input code. If it fails to compile for wasm,
  set `default-features = false` and list `playback`, `mp3`, `wav` (task 1.1 shows which).
