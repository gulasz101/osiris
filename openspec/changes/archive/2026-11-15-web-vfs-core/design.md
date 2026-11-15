# Design: web-vfs-core

## Crate `crates/osiris-vfs`
`Cargo.toml`: `name = "osiris-vfs"`, `edition.workspace = true`, `license.workspace = true`,
`version.workspace = true`, no dependencies. The workspace picks it up by itself
(`members = ["crates/*"]`).

### Files
- `src/lib.rs`: the public functions below. Each one is two small bodies:
  `#[cfg(not(target_arch = "wasm32"))]` calls `std::fs`, `#[cfg(target_arch = "wasm32")]` calls
  the in-memory store.
- `src/mem.rs`: `pub struct MemFs`, the in-memory store. It is compiled on **every** target
  (not behind a cfg), so its unit tests run with `cargo test` on the desktop.

### Public API (`osiris_vfs::...`)
All paths are `impl AsRef<Path>`. Errors are `std::io::Error`; "not found" uses
`std::io::ErrorKind::NotFound`, so callers that check for it keep working.

```rust
pub fn read(path) -> io::Result<Vec<u8>>
pub fn read_to_string(path) -> io::Result<String>          // InvalidData if not UTF-8
pub fn write(path, contents: impl AsRef<[u8]>) -> io::Result<()>
pub fn create_dir_all(path) -> io::Result<()>
pub fn remove_file(path) -> io::Result<()>
pub fn remove_dir_all(path) -> io::Result<()>
pub fn rename(from, to) -> io::Result<()>
pub fn read_dir(path) -> io::Result<Vec<DirEntry>>         // sorted by file name, on both targets
pub fn is_dir(path) -> bool
pub fn is_file(path) -> bool
pub fn exists(path) -> bool
pub fn modified(path) -> io::Result<std::time::SystemTime>
pub fn len(path) -> io::Result<u64>
pub fn open(path) -> io::Result<Reader>                    // Read + Seek

pub struct DirEntry { /* path: PathBuf, is_dir: bool */ }
impl DirEntry {
    pub fn path(&self) -> PathBuf
    pub fn file_name(&self) -> std::ffi::OsString
    pub fn is_dir(&self) -> bool
    pub fn is_file(&self) -> bool
}

// Desktop: a buffered file. Browser: the bytes in memory.
#[cfg(not(target_arch = "wasm32"))]
pub type Reader = std::io::BufReader<std::fs::File>;
#[cfg(target_arch = "wasm32")]
pub type Reader = std::io::Cursor<std::sync::Arc<[u8]>>;

// Browser only: the page calls this once per dropped file before the game starts.
#[cfg(target_arch = "wasm32")]
pub fn mount(path: &str, bytes: Vec<u8>)
```

Callers of `std::fs::read_dir` today write `for e in rd.flatten() { e.path() ... }`. With
`Vec<DirEntry>` that becomes `for e in rd { e.path() ... }`: remove `.flatten()` / `.ok()` on the
entries, keep the error handling on the `read_dir` call itself.

`modified` in the browser: `MemFs` keeps a counter that goes up on every write; return
`UNIX_EPOCH + Duration::from_secs(counter)`. Never call `SystemTime::now()` (it panics on wasm).

### MemFs rules
- Store: `BTreeMap<String, Entry>` where the key is the normalised path and `Entry` holds the
  original path (as given at write/mount time), the bytes as `Arc<[u8]>`, and the write counter.
  Directories: a `BTreeSet<String>` of normalised directory keys made by `create_dir_all`; every
  parent of a stored file is also a directory.
- Normalise a path: turn `\` into `/`, drop `.` parts, resolve `..`, drop a trailing `/`, and
  lower-case ASCII. The game's own files have mixed case (`Pharaoh_Text.eng`, `DATA/`), and the
  original game ran on Windows, so lookups are case-insensitive. Paths are absolute in the browser
  (the game folder is mounted at `/PharaohData`).
- `read_dir(dir)` lists the direct children (files and directories) with their **original**
  spelling, sorted by file name.
- `rename` of a missing file gives `NotFound`. `write` creates the parent directories.
- In the browser the free functions use one store:
  `thread_local! { static FS: RefCell<MemFs> = RefCell::new(MemFs::default()); }`
  (wasm has one thread, so this is the whole store).

### Tests (in `src/mem.rs`, run on desktop)
Write at least: write then read; read of a missing file is `NotFound`; case-insensitive lookup
(`mount("/G/Data/Pharaoh_Text.eng")`, read `/g/data/PHARAOH_TEXT.ENG`); `read_dir` returns direct
children only, original spelling, sorted; parent directories exist after a write; `rename`;
`remove_dir_all` removes everything below; `modified` grows with each write; `..` and `\`
normalise. Bytes are made up in the test (`b"abc"`), never game data.

## Switching the game-data crates
Add `osiris-vfs = { path = "../osiris-vfs" }` to `[dependencies]` of each crate, then replace
call by call. Run `scripts/no-direct-fs.sh <crate>/src` to list what is left in that crate.

- `std::fs::read(p)` -> `osiris_vfs::read(p)`; same for `read_to_string`, `write`,
  `create_dir_all`, `remove_file`, `remove_dir_all`, `rename`.
- `p.is_dir()` / `p.is_file()` / `p.exists()` on a path -> `osiris_vfs::is_dir(p)` / ...
  (careful: `DirEntry::is_dir()` from `osiris_vfs` is fine, the script only means `Path` calls; if
  the script flags a `DirEntry` call, rename nothing, but tell the PM in your comment).
- `std::fs::metadata(p).and_then(|m| m.modified())` -> `osiris_vfs::modified(p)`;
  `std::fs::metadata(p).map(|m| m.len())` -> `osiris_vfs::len(p)`.
- `osiris-bink/src/lib.rs`: `impl Movie<BufReader<File>>` with `File::open(path)` ->
  `impl Movie<osiris_vfs::Reader>` with `osiris_vfs::open(path)?`. Remove the `use std::fs::File`.
- Code inside `#[cfg(test)]` modules keeps `std::fs` (tests run on desktop only).
