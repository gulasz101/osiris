//! Virtual file system: `std::fs` on desktop, an in-memory store in the browser.
//!
//! On desktop every function delegates to [`std::fs`].  On `wasm32-unknown-unknown` the same
//! functions operate on a case-insensitive in-memory store that is filled by the page via
//! [`mount`] before the game starts.

mod mem;
pub use mem::{DirEntry, MemFs};

use std::io::{self};
use std::path::Path;
use std::time::SystemTime;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::thread_local;

// ── Reader type alias ───────────────────────────────────────────────

/// A buffered reader over a file (desktop) or in-memory bytes (browser).
#[cfg(not(target_arch = "wasm32"))]
pub type Reader = std::io::BufReader<std::fs::File>;

/// A cursor over in-memory bytes, implementing [`Read`] and [`Seek`].
#[cfg(target_arch = "wasm32")]
pub type Reader = std::io::Cursor<std::sync::Arc<[u8]>>;

// ── Desktop implementation (std::fs) ────────────────────────────────

/// Read the entire contents of a file into a bytes vector.
#[cfg(not(target_arch = "wasm32"))]
pub fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> {
    std::fs::read(path)
}

/// Read the entire contents of a file into a string (must be valid UTF-8).
#[cfg(not(target_arch = "wasm32"))]
pub fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> {
    std::fs::read_to_string(path)
}

/// Write bytes to a file, creating parent directories as needed.
#[cfg(not(target_arch = "wasm32"))]
pub fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> io::Result<()> {
    std::fs::write(path, contents)
}

/// Create a directory and all missing parent directories.
#[cfg(not(target_arch = "wasm32"))]
pub fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    std::fs::create_dir_all(path)
}

/// Remove a single file. Returns [`io::ErrorKind::NotFound`] if the file does not exist.
#[cfg(not(target_arch = "wasm32"))]
pub fn remove_file(path: impl AsRef<Path>) -> io::Result<()> {
    std::fs::remove_file(path)
}

/// Recursively remove a directory and all its contents.
#[cfg(not(target_arch = "wasm32"))]
pub fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    std::fs::remove_dir_all(path)
}

/// Rename (or move) a file or directory. Returns [`io::ErrorKind::NotFound`] if the source does not exist.
#[cfg(not(target_arch = "wasm32"))]
pub fn rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
    std::fs::rename(from, to)
}

/// Read the direct children of a directory, sorted by file name.
#[cfg(not(target_arch = "wasm32"))]
pub fn read_dir(path: impl AsRef<Path>) -> io::Result<Vec<DirEntry>> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(path)?
        .filter_map(|e| e.ok())
        .map(|e| DirEntry {
            path: e.path().to_string_lossy().into_owned(),
            is_dir: e.path().is_dir(),
        })
        .collect();
    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(entries)
}

/// Returns `true` if the path points to a directory.
#[cfg(not(target_arch = "wasm32"))]
pub fn is_dir(path: impl AsRef<Path>) -> bool {
    path.as_ref().is_dir()
}

/// Returns `true` if the path points to a regular file.
#[cfg(not(target_arch = "wasm32"))]
pub fn is_file(path: impl AsRef<Path>) -> bool {
    path.as_ref().is_file()
}

/// Returns `true` if the path exists (as a file or directory).
#[cfg(not(target_arch = "wasm32"))]
pub fn exists(path: impl AsRef<Path>) -> bool {
    path.as_ref().exists()
}

/// Return the last modification time of a file.
#[cfg(not(target_arch = "wasm32"))]
pub fn modified(path: impl AsRef<Path>) -> io::Result<SystemTime> {
    std::fs::metadata(path)?.modified()
}

/// Return the length of a file in bytes.
#[cfg(not(target_arch = "wasm32"))]
pub fn len(path: impl AsRef<Path>) -> io::Result<u64> {
    Ok(std::fs::metadata(path)?.len())
}

/// Open a file for reading, returning a buffered reader.
#[cfg(not(target_arch = "wasm32"))]
pub fn open(path: impl AsRef<Path>) -> io::Result<Reader> {
    Ok(std::io::BufReader::new(std::fs::File::open(path)?))
}

// ── Browser implementation (in-memory store) ────────────────────────

#[cfg(target_arch = "wasm32")]
thread_local! {
    static FS: RefCell<MemFs> = RefCell::new(MemFs::default());
}

/// Read the entire contents of a file into a bytes vector.
#[cfg(target_arch = "wasm32")]
pub fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> {
    let path = path.as_ref();
    FS.with(|fs| {
        fs.borrow()
            .read(path.to_str().unwrap_or_default())
            .map(|bytes| bytes.as_ref().to_vec())
            .ok_or_else(|| io::ErrorKind::NotFound.into())
    })
}

/// Read the entire contents of a file into a string (must be valid UTF-8).
#[cfg(target_arch = "wasm32")]
pub fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> {
    let bytes = read(&path)?;
    String::from_utf8(bytes).map_err(|_| io::ErrorKind::InvalidData.into())
}

/// Write bytes to a file, creating parent directories as needed.
#[cfg(target_arch = "wasm32")]
pub fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> io::Result<()> {
    let path = path.as_ref();
    FS.with(|fs| fs.borrow_mut().write(path.to_str().unwrap_or_default(), contents.as_ref().to_vec()));
    Ok(())
}

/// Create a directory and all missing parent directories.
#[cfg(target_arch = "wasm32")]
pub fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    let path = path.as_ref();
    FS.with(|fs| fs.borrow_mut().create_dir_all(path.to_str().unwrap_or_default()));
    Ok(())
}

/// Remove a single file. Returns [`io::ErrorKind::NotFound`] if the file does not exist.
#[cfg(target_arch = "wasm32")]
pub fn remove_file(path: impl AsRef<Path>) -> io::Result<()> {
    let path = path.as_ref();
    FS.with(|fs| {
        if !fs.borrow_mut().remove_file(path.to_str().unwrap_or_default()) {
            return Err(io::ErrorKind::NotFound.into());
        }
        Ok(())
    })
}

/// Recursively remove a directory and all its contents.
#[cfg(target_arch = "wasm32")]
pub fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    let path = path.as_ref();
    FS.with(|fs| fs.borrow_mut().remove_dir_all(path.to_str().unwrap_or_default()));
    Ok(())
}

/// Rename (or move) a file or directory. Returns [`io::ErrorKind::NotFound`] if the source does not exist.
#[cfg(target_arch = "wasm32")]
pub fn rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
    let from = from.as_ref();
    let to = to.as_ref();
    FS.with(|fs| {
        if !fs.borrow_mut().rename(
            from.to_str().unwrap_or_default(),
            to.to_str().unwrap_or_default(),
        ) {
            return Err(io::ErrorKind::NotFound.into());
        }
        Ok(())
    })
}

/// Read the direct children of a directory, sorted by file name.
#[cfg(target_arch = "wasm32")]
pub fn read_dir(path: impl AsRef<Path>) -> io::Result<Vec<DirEntry>> {
    let path = path.as_ref();
    let entries = FS.with(|fs| fs.borrow().read_dir(path.to_str().unwrap_or_default()));
    Ok(entries)
}

/// Returns `true` if the path points to a directory.
#[cfg(target_arch = "wasm32")]
pub fn is_dir(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();
    FS.with(|fs| fs.borrow().is_dir_path(path.to_str().unwrap_or_default()))
}

/// Returns `true` if the path points to a regular file.
#[cfg(target_arch = "wasm32")]
pub fn is_file(path: impl AsRef<Path>) -> bool {
    let path = path.as_ref();
    FS.with(|fs| fs.borrow().is_file(path.to_str().unwrap_or_default()))
}

/// Returns `true` if the path exists (as a file or directory).
#[cfg(target_arch = "wasm32")]
pub fn exists(path: impl AsRef<Path>) -> bool {
    is_dir(&path) || is_file(&path)
}

/// Return the last modification time of a file.
#[cfg(target_arch = "wasm32")]
pub fn modified(path: impl AsRef<Path>) -> io::Result<SystemTime> {
    let path = path.as_ref();
    FS.with(|fs| {
        fs.borrow()
            .modified_seq(path.to_str().unwrap_or_default())
            .map(|seq| SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(seq))
            .ok_or(io::ErrorKind::NotFound.into())
    })
}

/// Return the length of a file in bytes.
#[cfg(target_arch = "wasm32")]
pub fn len(path: impl AsRef<Path>) -> io::Result<u64> {
    let path = path.as_ref();
    FS.with(|fs| {
        fs.borrow()
            .read(path.to_str().unwrap_or_default())
            .map(|bytes| bytes.len() as u64)
            .ok_or(io::ErrorKind::NotFound.into())
    })
}

/// Open a file for reading, returning a buffered reader.
#[cfg(target_arch = "wasm32")]
pub fn open(path: impl AsRef<Path>) -> io::Result<Reader> {
    let path = path.as_ref();
    FS.with(|fs| {
        fs.borrow()
            .read(path.to_str().unwrap_or_default())
            .map(|bytes| std::io::Cursor::new(bytes))
            .ok_or(io::ErrorKind::NotFound.into())
    })
}

/// Mount a single file into the in-memory store (browser only).
///
/// Called once per dropped file by the page before the game starts.
#[cfg(target_arch = "wasm32")]
pub fn mount(path: &str, bytes: Vec<u8>) {
    FS.with(|fs| fs.borrow_mut().mount(path, bytes));
}
