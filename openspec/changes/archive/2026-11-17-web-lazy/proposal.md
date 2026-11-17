# web-lazy: read each game file only when the game opens it

## Why
The web-soak run logs `memory start 931 MB end 931 MB`. Before the game starts, the page copies
every file of the 778 MB install into wasm memory with `mount_file`, and wasm memory never
shrinks. A laptop tab at 1 GB is close to the point where the browser kills it, and most of
those bytes are movies and sounds that a session plays once or never. This change keeps the
picked files where the browser already has them (the `File` objects from the picker or from
OPFS, which sit on disk) and copies a file into wasm memory only when the game reads it.

## What changes
- `web/files.js` (new): a map from VFS path to `File`, and `read(path)`, which reads one file
  synchronously. It is the only place that reads game bytes from now on.
- `crates/osiris-vfs/src/mem.rs` and `lib.rs`: a file entry can be "lazy": the store knows its
  path and size, but not its bytes. Reading a lazy entry asks a reader hook for the bytes and
  does not keep them. `osiris_vfs::mount_lazy(path, len)` and `osiris_vfs::set_lazy_reader(fn)`.
- `crates/osiris-app/src/web.rs`: the wasm export `mount_lazy(path, len)` and the reader hook,
  which calls `osirisFiles.read` in `files.js`.
- `web/main.js` and `web/opfs.js`: the picker and the OPFS restore register each `File` and call
  `mount_lazy` instead of reading the bytes and calling `mount_file`.
- `web/tests/smoke.mjs`: `SMOKE_SYNCREAD=1` proves the synchronous read in the test browser
  before anything else is built on it.

## Out of scope
- Running the game in a Web Worker (it would allow `FileReaderSync`, but moves the renderer).
- Reading part of a file (`File.slice` with a seekable reader for movies). Whole files only.
- Any change to what the game reads or when. Game rules do not change.
