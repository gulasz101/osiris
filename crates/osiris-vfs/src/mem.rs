use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

/// A change to the file system that occurred under a watched prefix.
pub use self::change::Change;
mod change {
    /// A single change recorded by [`crate::MemFs::watch`].
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum Change {
        /// A file was written or overwritten.
        Put(String, Vec<u8>),
        /// A file was deleted.
        Delete(String),
    }
}

/// The bytes of one entry: either in the store, or still where the browser holds them.
#[derive(Debug, Clone)]
enum Data {
    /// The file's bytes, in memory.
    Bytes(Arc<[u8]>),
    /// A file the page keeps outside wasm memory: its length is known, and its bytes are
    /// read from the browser's own file when the game asks for them, then dropped again.
    Lazy { len: u64 },
}

impl Data {
    /// The bytes in the store, or `None` for a file that still has to be read.
    fn bytes(&self) -> Option<&Arc<[u8]>> {
        match self {
            Data::Bytes(bytes) => Some(bytes),
            Data::Lazy { .. } => None,
        }
    }
}

/// A single entry in the in-memory file store.
#[derive(Debug, Clone)]
struct Entry {
    /// The original path as given at mount/write time (for DirEntry display).
    original: String,
    /// The file's bytes, or the promise of them (see [`Data`]).
    data: Data,
    /// Monotonically increasing write counter (used for modified timestamps).
    seq: u64,
}

/// The most bytes of lazy reads the store keeps: 32 MiB of the game's own files, read from
/// the browser once and then out of memory (`web-perf`).
const LAZY_CACHE_BYTES: usize = 32 * 1024 * 1024;

/// A lazy file bigger than this is read every time it is opened. A movie or a big archive is
/// not worth keeping, and keeping it would push everything else out of the cache.
const LAZY_CACHE_MAX_FILE: usize = 8 * 1024 * 1024;

/// The lazy reads the store has kept, least recently read first.
///
/// A city's ambient sound is opened again every time it plays: without this, each open is a
/// synchronous read through the page, on the main thread, in the middle of a frame.
#[derive(Default)]
struct LazyCache {
    /// The bytes kept, least recently read first, and the path each one was read for.
    entries: Vec<(String, Arc<[u8]>)>,
    /// How many bytes `entries` holds.
    bytes: usize,
}

impl LazyCache {
    /// The bytes kept for `key`, moved to the back as the most recently read.
    fn get(&mut self, key: &str) -> Option<Arc<[u8]>> {
        let at = self.entries.iter().position(|(path, _)| path == key)?;
        let (path, bytes) = self.entries.remove(at);
        let bytes = bytes.clone();
        self.entries.push((path, bytes.clone()));
        Some(bytes)
    }

    /// Keeps `bytes` for `key`, dropping the least recently read files until it fits. A file
    /// over [`LAZY_CACHE_MAX_FILE`] is not kept at all.
    fn keep(&mut self, key: String, bytes: Arc<[u8]>) {
        if bytes.len() > LAZY_CACHE_MAX_FILE {
            return;
        }
        while self.bytes + bytes.len() > LAZY_CACHE_BYTES {
            if self.entries.is_empty() {
                return;
            }
            let (_, dropped) = self.entries.remove(0);
            self.bytes -= dropped.len();
        }
        self.bytes += bytes.len();
        self.entries.push((key, bytes));
    }

    /// Forgets the bytes kept for `key`: the file there changed, or was mounted again.
    fn forget(&mut self, key: &str) {
        if let Some(at) = self.entries.iter().position(|(path, _)| path == key) {
            let (_, dropped) = self.entries.remove(at);
            self.bytes -= dropped.len();
        }
    }
}

/// An in-memory virtual file system with case-insensitive lookups.
///
/// Paths are normalised by converting `\` to `/`, resolving `.` and `..`,
/// dropping a trailing slash, and lower-casing ASCII letters.  Directories
/// are created implicitly when files are written or explicitly via
/// `create_dir_all`.
#[derive(Default)]
pub struct MemFs {
    /// File entries keyed by normalised path.
    files: BTreeMap<String, Entry>,
    /// The reader a lazy entry asks for its bytes, set by the page ([`Self::set_lazy_reader`]).
    lazy_reader: Option<fn(&str) -> Option<Vec<u8>>>,
    /// Directory keys (normalised paths).
    dirs: BTreeSet<String>,
    /// Monotonic counter for `modified` timestamps.
    seq: u64,
    /// Normalised prefix being watched for changes (e.g. "/user"), or `None`.
    watch_prefix: Option<String>,
    /// Recorded changes since the last call to [`Self::take_changes`].
    changes: Vec<Change>,
    /// The lazy reads kept in memory, so a file opened twice is read from the browser once.
    lazy_cache: RefCell<LazyCache>,
}

// ── Normalisation ────────────────────────────────────────────────────

/// Normalise a path for internal storage.
fn normalise(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let parts: Vec<&str> = replaced
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();

    let mut resolved: Vec<&str> = Vec::new();
    for part in &parts {
        if *part == ".." {
            resolved.pop();
        } else {
            resolved.push(*part);
        }
    }

    resolved.join("/").to_ascii_lowercase()
}

/// Check whether `normalized_path` is strictly under `normalized_prefix`.
/// Both strings must already be normalised (lower-cased, no trailing slash).
fn is_under(normalized_path: &str, normalized_prefix: &str) -> bool {
    if normalized_path == normalized_prefix {
        return false;
    }
    normalized_path.starts_with(normalized_prefix)
        && normalized_path.as_bytes().get(normalized_prefix.len()) == Some(&b'/')
}

/// Return all parent directory keys for a normalised path (excludes the final component).
fn parent_dirs(normalised: &str) -> Vec<String> {
    let mut dirs = Vec::new();
    let mut current = String::new();
    let parts: Vec<&str> = normalised.split('/').filter(|s| !s.is_empty()).collect();
    // Exclude the last component (the file name itself).
    for part in &parts[..parts.len().saturating_sub(1)] {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(part);
        dirs.push(current.clone());
    }
    dirs
}

// ── Public MemFs API ────────────────────────────────────────────────

impl MemFs {
    /// Mount a single file into the store.
    pub fn mount(&mut self, path: &str, data: Vec<u8>) {
        let norm = normalise(path);
        self.seq += 1;
        self.files.insert(
            norm.clone(),
            Entry {
                original: path.to_owned(),
                data: Data::Bytes(Arc::from(data.into_boxed_slice())),
                seq: self.seq,
            },
        );
        for d in parent_dirs(&norm) {
            self.dirs.insert(d);
        }
    }

    /// Mount a file the store does not hold the bytes of, only its length.
    ///
    /// This is what the browser uses: the page's `File` stays where the browser has it, on
    /// disk, and [`Self::read`] asks the reader set with [`Self::set_lazy_reader`] for the
    /// bytes when the game opens the file. They are handed over and then dropped, so a
    /// session's memory holds only what the game is using at that moment.
    pub fn mount_lazy(&mut self, path: &str, len: u64) {
        let norm = normalise(path);
        // A file mounted again is read again: whatever the cache holds for this path is the
        // bytes of the file that was there before.
        self.lazy_cache.borrow_mut().forget(&norm);
        self.seq += 1;
        self.files.insert(
            norm.clone(),
            Entry {
                original: path.to_owned(),
                data: Data::Lazy { len },
                seq: self.seq,
            },
        );
        for d in parent_dirs(&norm) {
            self.dirs.insert(d);
        }
    }

    /// Set the reader lazy entries ask for their bytes, or `None` for none.
    ///
    /// The reader is given the entry's original path, the one [`Self::mount_lazy`] was
    /// called with, which is the key the page registered the file under.
    pub fn set_lazy_reader(&mut self, reader: Option<fn(&str) -> Option<Vec<u8>>>) {
        self.lazy_reader = reader;
    }

    /// Write bytes to a path (creates parent directories implicitly).
    pub fn write(&mut self, path: &str, data: Vec<u8>) {
        let norm = normalise(path);
        self.seq += 1;
        self.files.insert(
            norm.clone(),
            Entry {
                original: path.to_owned(),
                data: Data::Bytes(Arc::from(data.clone().into_boxed_slice())),
                seq: self.seq,
            },
        );
        for d in parent_dirs(&norm) {
            self.dirs.insert(d);
        }

        // Record change if watching and the path is under the watched prefix.
        if let Some(ref prefix) = self.watch_prefix {
            if is_under(&norm, prefix) {
                self.changes.push(Change::Put(path.to_owned(), data));
            }
        }
    }

    /// Create directory (and all parents).
    pub fn create_dir_all(&mut self, path: &str) {
        let norm = normalise(path);
        for d in parent_dirs(&norm) {
            self.dirs.insert(d);
        }
    }

    /// Read bytes from the store. Returns `None` if missing.
    ///
    /// A lazy entry's bytes come from the reader set with [`Self::set_lazy_reader`]. They are
    /// kept (up to [`LAZY_CACHE_BYTES`], and never a file over [`LAZY_CACHE_MAX_FILE`]), so a
    /// file the game opens again is read from the browser once (`web-perf`). Without a reader
    /// a lazy entry reads as missing, which is what callers already turn into `NotFound`.
    pub fn read(&self, path: &str) -> Option<Arc<[u8]>> {
        let norm = normalise(path);
        let entry = self.files.get(&norm)?;
        match &entry.data {
            Data::Bytes(bytes) => Some(bytes.clone()),
            Data::Lazy { .. } => {
                if let Some(bytes) = self.lazy_cache.borrow_mut().get(&norm) {
                    return Some(bytes);
                }
                let reader = self.lazy_reader?;
                let bytes: Arc<[u8]> = Arc::from(reader(&entry.original)?.into_boxed_slice());
                self.lazy_cache.borrow_mut().keep(norm, bytes.clone());
                Some(bytes)
            }
        }
    }

    /// The length of a file in bytes, without reading a lazy entry's bytes.
    pub fn len(&self, path: &str) -> Option<u64> {
        let entry = self.files.get(&normalise(path))?;
        match &entry.data {
            Data::Bytes(bytes) => Some(bytes.len() as u64),
            Data::Lazy { len } => Some(*len),
        }
    }

    /// The bytes of an entry, reading them from the browser when it is a lazy one.
    ///
    /// Used wherever the store has to keep the bytes it was handed: a rename, which moves
    /// the entry to a path the page has no file for, or a change recorded for `/user`.
    fn entry_bytes(&self, entry: &Entry) -> Option<Arc<[u8]>> {
        match &entry.data {
            Data::Bytes(bytes) => Some(bytes.clone()),
            Data::Lazy { .. } => {
                let reader = self.lazy_reader?;
                let bytes = reader(&entry.original)?;
                Some(Arc::from(bytes.into_boxed_slice()))
            }
        }
    }

    /// An entry that keeps its bytes in the store: a lazy one is read first.
    fn into_bytes(&self, entry: Entry) -> Entry {
        match entry.data {
            Data::Bytes(_) => entry,
            Data::Lazy { .. } => {
                let bytes = match self.entry_bytes(&entry) {
                    Some(bytes) => Data::Bytes(bytes),
                    // Without a reader there are no bytes to keep, so the entry stays lazy
                    // and reads as missing from its new path.
                    None => entry.data,
                };
                Entry { original: entry.original, data: bytes, seq: entry.seq }
            }
        }
    }

    /// Rename a file or directory. Returns false if source does not exist.
    pub fn rename(&mut self, from: &str, to: &str) -> bool {
        let from_norm = normalise(from);
        let to_norm = normalise(to);

        // Check whether `from` is a directory (has files under it).
        let has_children = self.files.keys().any(|k| is_under(k, &from_norm));

        if has_children {
            // Directory rename: move all files and directories under `from` to under `to`.
            // A lazy file is read first, as a single-file rename does below: its new path
            // has no file registered in the page.
            let children: Vec<(String, Entry)> = self
                .files
                .iter()
                .filter(|(k, _)| is_under(k, &from_norm))
                .map(|(k, v)| (k.clone(), self.into_bytes((*v).clone())))
                .collect();

            // Record changes for watched files.
            if let Some(ref watch) = self.watch_prefix {
                for (old_key, entry) in &children {
                    let new_key = format!("{}{}", to_norm, &old_key[from_norm.len()..]);
                    if is_under(old_key, watch) {
                        self.changes.push(Change::Delete(entry.original.clone()));
                    }
                    if is_under(&new_key, watch) {
                        // Compute the new "original" path from the target directory name
                        // and the relative portion of the old key.
                        let new_original = format!(
                            "{}{}",
                            to,
                            &old_key[from_norm.len()..]
                                .replace('/', std::path::MAIN_SEPARATOR_STR)
                        );
                        if let Some(bytes) = entry.data.bytes() {
                            self.changes.push(Change::Put(new_original, bytes.as_ref().to_vec()));
                        }
                    }
                }
            }

            // Move files.
            for (old_key, entry) in children {
                let new_key = format!("{}{}", to_norm, &old_key[from_norm.len()..]);
                self.seq += 1;
                self.files.insert(
                    new_key.clone(),
                    Entry {
                        original: entry.original,
                        data: entry.data,
                        seq: self.seq,
                    },
                );
                self.files.remove(&old_key);
            }

            // Move directories.
            let dir_children: Vec<String> = self
                .dirs
                .iter()
                .filter(|k| is_under(k, &from_norm))
                .cloned()
                .collect();
            for old_dir in dir_children {
                let new_dir = format!("{}{}", to_norm, &old_dir[from_norm.len()..]);
                self.dirs.remove(&old_dir);
                self.dirs.insert(new_dir);
            }

            true
        } else if self.files.contains_key(&from_norm) {
            // Single-file rename (existing behaviour). A lazy entry is read first: the page
            // registered its file under the old path, and the new path has none.
            let entry = self.files.remove(&from_norm).unwrap();
            let entry = self.into_bytes(entry);
            self.seq += 1;
            self.files.insert(
                to_norm.clone(),
                Entry {
                    original: entry.original.clone(),
                    data: entry.data.clone(),
                    seq: self.seq,
                },
            );
            for d in parent_dirs(&to_norm) {
                self.dirs.insert(d);
            }

            // Record changes if watching.
            if let Some(ref watch) = self.watch_prefix {
                if is_under(&from_norm, watch) {
                    self.changes.push(Change::Delete(entry.original));
                }
                if is_under(&to_norm, watch) {
                    if let Some(bytes) = entry.data.bytes() {
                        self.changes.push(Change::Put(to.to_owned(), bytes.as_ref().to_vec()));
                    }
                }
            }

            true
        } else {
            false
        }
    }

    /// Remove a single file. Returns false if missing.
    pub fn remove_file(&mut self, path: &str) -> bool {
        let norm = normalise(path);
        if let Some(entry) = self.files.remove(&norm) {
            // Record change if watching and the path is under the watched prefix.
            if let Some(ref prefix) = self.watch_prefix {
                if is_under(&norm, prefix) {
                    self.changes.push(Change::Delete(entry.original));
                }
            }
            true
        } else {
            false
        }
    }

    /// Recursively remove everything under `path` (files and directories).
    pub fn remove_dir_all(&mut self, path: &str) {
        let norm = normalise(path);

        // Collect files under this directory BEFORE removal.
        let to_remove: Vec<(String, Entry)> = self
            .files
            .iter()
            .filter(|(k, _)| is_under(k, &norm))
            .map(|(k, v)| (k.clone(), (*v).clone()))
            .collect();

        // Record changes for watched files.
        if let Some(ref watch) = self.watch_prefix {
            for (key, entry) in &to_remove {
                if is_under(key, watch) {
                    self.changes.push(Change::Delete(entry.original.clone()));
                }
            }
        }

        // Actually remove files.
        let to_remove_keys: Vec<String> = to_remove.iter().map(|(k, _)| k.clone()).collect();
        for k in to_remove_keys {
            self.files.remove(&k);
        }

        // Remove directories whose key starts with the prefix (but not the dir itself).
        let to_remove_dirs: Vec<String> = self
            .dirs
            .iter()
            .filter(|k| is_under(k, &norm))
            .cloned()
            .collect();
        for d in to_remove_dirs {
            self.dirs.remove(&d);
        }
    }

    /// Return the direct children of a directory as `DirEntry`s, sorted by file name.
    pub fn read_dir(&self, path: &str) -> Vec<DirEntry> {
        let prefix = normalise(path);

        // Collect all direct-child keys (one level below).
        let mut children: BTreeMap<String, DirEntry> = BTreeMap::new();

        // Process directories first so they take precedence over files with the same name.
        for dir in &self.dirs {
            if **dir == prefix {
                continue; // skip the directory itself
            }
            if !dir.starts_with(&prefix) {
                continue; // not under this prefix
            }
            let after_prefix = &dir[prefix.len()..];
            if !after_prefix.starts_with('/') {
                continue;
            }
            let rest = &after_prefix[1..];
            if rest.is_empty() || rest.contains('/') {
                continue; // not a direct child
            }
            let child_key = format!("{}/{}", prefix, rest);
            children.entry(child_key).or_insert_with(|| DirEntry {
                path: dir.clone(),
                is_dir: true,
            });
        }

        // Then process files (directories already inserted above take precedence).
        for (key, entry) in &self.files {
            if key.starts_with(&prefix) && *key != prefix {
                let after_prefix = &key[prefix.len()..];
                if !after_prefix.starts_with('/') {
                    continue;
                }
                let rest = &after_prefix[1..];
                let child_name = match rest.find('/') {
                    Some(pos) => &rest[..pos],
                    None => rest,
                };
                if child_name.is_empty() {
                    continue;
                }
                let child_key = format!("{}/{}", prefix, child_name);
                children.entry(child_key).or_insert_with(|| DirEntry {
                    path: entry.original.clone(),
                    is_dir: false,
                });
            }
        }

        // Sort case-insensitively by file name and return.
        let mut result: Vec<DirEntry> = children.into_values().collect();
        result.sort_by(|a, b| {
            a.file_name()
                .to_ascii_lowercase()
                .cmp(&b.file_name().to_ascii_lowercase())
        });
        result
    }

    /// Return the write sequence number for a path (used for `modified`).
    pub fn modified_seq(&self, path: &str) -> Option<u64> {
        self.files.get(&normalise(path)).map(|e| e.seq)
    }

    /// Check if a normalised key is a file.
    pub fn is_file(&self, path: &str) -> bool {
        self.files.contains_key(&normalise(path))
    }

    /// Record changes to files whose path starts with `prefix` (case-insensitive).
    ///
    /// After calling this method every write, delete and rename under the prefix
    /// is recorded.  Call [`Self::take_changes`] to consume them.
    pub fn watch(&mut self, prefix: &str) {
        let norm = normalise(prefix);
        self.watch_prefix = Some(norm.clone());
        self.changes.clear();
    }

    /// Return and clear the recorded changes, oldest first.
    pub fn take_changes(&mut self) -> Vec<Change> {
        std::mem::take(&mut self.changes)
    }

    /// Check if a normalised key is a directory.
    pub fn is_dir_path(&self, path: &str) -> bool {
        self.dirs.contains(&normalise(path))
    }
}

/// Entry returned by `read_dir`.
#[derive(Debug, Clone)]
pub struct DirEntry {
    /// The original path as stored.
    pub path: String,
    /// Whether this entry is a directory.
    pub is_dir: bool,
}

impl DirEntry {
    /// Return the path as a `PathBuf`.
    pub fn path_buf(&self) -> PathBuf {
        PathBuf::from(&self.path)
    }

    /// Return the file name component.
    pub fn file_name(&self) -> OsString {
        self.path_buf()
            .file_name()
            .unwrap_or_default()
            .to_os_string()
    }

    /// Whether this entry is a directory.
    pub fn is_dir(&self) -> bool {
        self.is_dir
    }

    /// Whether this entry is a file.
    pub fn is_file(&self) -> bool {
        !self.is_dir
    }
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::thread_local;
    use std::time::{Duration, SystemTime};

    thread_local! {
        /// How many times `counting_reader` has been asked, on this test's own thread.
        static LAZY_CALLS: Cell<usize> = const { Cell::new(0) };
        /// How many bytes `sized_reader` answers with, for the cache's size rules.
        static LAZY_SIZE: Cell<usize> = const { Cell::new(0) };
    }

    /// A reader for the lazy tests: it answers for one path only, in the spelling it was
    /// mounted with, and gives a different answer each time, so a copy the store kept
    /// would show.
    fn counting_reader(path: &str) -> Option<Vec<u8>> {
        if path != "/PharaohData/Data/Lazy.SG3" {
            return None;
        }
        LAZY_CALLS.with(|calls| {
            calls.set(calls.get() + 1);
            Some(format!("read {}", calls.get()).into_bytes())
        })
    }

    /// A reader for the cache's size rules: it answers every path with [`LAZY_SIZE`] bytes,
    /// the last one counting the read, so a caller can tell the reads apart.
    fn sized_reader(_path: &str) -> Option<Vec<u8>> {
        LAZY_CALLS.with(|calls| {
            calls.set(calls.get() + 1);
            let n = LAZY_SIZE.with(Cell::get);
            let mut bytes = vec![0u8; n];
            if let Some(last) = bytes.last_mut() {
                *last = calls.get() as u8;
            }
            Some(bytes)
        })
    }

    /// A test that counts reads starts from zero: the counters are this thread's own.
    fn counting_fs() -> MemFs {
        LAZY_CALLS.with(|calls| calls.set(0));
        let mut fs = MemFs::default();
        fs.set_lazy_reader(Some(counting_reader));
        fs
    }

    /// A store whose lazy files all answer with `size` bytes (`sized_reader`).
    fn sized_fs(size: usize) -> MemFs {
        LAZY_CALLS.with(|calls| calls.set(0));
        LAZY_SIZE.with(|s| s.set(size));
        let mut fs = MemFs::default();
        fs.set_lazy_reader(Some(sized_reader));
        fs
    }

    #[test]
    fn lazy_read_keeps_a_small_file_and_reads_it_from_browser_once() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert!(fs.is_file("/pharaohdata/data/lazy.sg3"));

        // The reader is given the original path, whatever spelling the game looked up.
        assert_eq!(fs.read("/pharaohdata/DATA/lazy.sg3").as_deref(), Some(&b"read 1"[..]));
        // The bytes are kept, so the second read, in another spelling, asks for nothing.
        assert_eq!(fs.read("/PharaohData/Data/Lazy.SG3").as_deref(), Some(&b"read 1"[..]));
        assert_eq!(LAZY_CALLS.with(Cell::get), 1);
    }

    #[test]
    fn lazy_read_of_a_big_file_asks_the_reader_every_time() {
        let size = LAZY_CACHE_MAX_FILE + 1;
        let mut fs = sized_fs(size);
        fs.mount_lazy("/PharaohData/Data/Movie.BIK", size as u64);

        assert_eq!(fs.read("/PharaohData/Data/Movie.BIK").map(|b| b.len()), Some(size));
        // Over the per-file limit nothing is kept: a movie is read again, not held.
        assert_eq!(fs.read("/PharaohData/Data/Movie.BIK").map(|b| b.len()), Some(size));
        assert_eq!(LAZY_CALLS.with(Cell::get), 2);
    }

    #[test]
    fn lazy_cache_drops_the_least_recently_read_when_it_is_full() {
        // Five files of 7 MiB do not fit in the 32 MiB budget, so the first is dropped.
        let size = 7 * 1024 * 1024;
        let mut fs = sized_fs(size);
        let names: Vec<String> = (0..5).map(|i| format!("/PharaohData/Data/F{i}.SG3")).collect();
        for name in &names {
            fs.mount_lazy(name, size as u64);
            assert_eq!(fs.read(name).map(|b| b.len()), Some(size));
        }
        assert_eq!(LAZY_CALLS.with(Cell::get), 5);

        // The second file is still kept: reading it asks for nothing.
        assert!(fs.read(&names[1]).is_some());
        assert_eq!(LAZY_CALLS.with(Cell::get), 5);
        // The first was the least recently read, so it was dropped and is read again.
        assert!(fs.read(&names[0]).is_some());
        assert_eq!(LAZY_CALLS.with(Cell::get), 6);
    }

    #[test]
    fn mounting_a_lazy_file_again_reads_it_again() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert_eq!(fs.read("/PharaohData/Data/Lazy.SG3").as_deref(), Some(&b"read 1"[..]));
        // A second mount is a different file at the same path, so the kept bytes are gone.
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert_eq!(fs.read("/PharaohData/Data/Lazy.SG3").as_deref(), Some(&b"read 2"[..]));
        assert_eq!(LAZY_CALLS.with(Cell::get), 2);
    }

    #[test]
    fn lazy_entry_lists_with_its_length_and_asks_for_nothing() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 4242);

        let entries = fs.read_dir("/PharaohData/Data");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].file_name(), "Lazy.SG3");
        assert!(entries[0].is_file());
        assert_eq!(entries[0].path, "/PharaohData/Data/Lazy.SG3");

        // The length is the page's own number, and neither it nor the listing reads bytes.
        assert_eq!(fs.len("/PharaohData/Data/Lazy.SG3"), Some(4242));
        assert!(fs.modified_seq("/PharaohData/Data/Lazy.SG3").is_some());
        assert_eq!(LAZY_CALLS.with(Cell::get), 0);
    }

    #[test]
    fn lazy_without_a_reader_reads_as_missing() {
        let mut fs = MemFs::default();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert!(fs.read("/PharaohData/Data/Lazy.SG3").is_none());
        assert_eq!(fs.len("/PharaohData/Data/Lazy.SG3"), Some(6));
    }

    #[test]
    fn lazy_with_a_reader_that_does_not_know_the_path_reads_as_missing() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Other.SG3", 6);
        assert!(fs.read("/PharaohData/Data/Other.SG3").is_none());
    }

    #[test]
    fn write_replaces_a_lazy_entry() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        fs.write("/PharaohData/Data/Lazy.SG3", b"mine".to_vec());

        assert_eq!(fs.read("/PharaohData/Data/Lazy.SG3").as_deref(), Some(&b"mine"[..]));
        assert_eq!(fs.len("/PharaohData/Data/Lazy.SG3"), Some(4));
        assert_eq!(LAZY_CALLS.with(Cell::get), 0);
    }

    #[test]
    fn remove_file_removes_a_lazy_entry() {
        let mut fs = MemFs::default();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert!(fs.remove_file("/PharaohData/Data/Lazy.SG3"));
        assert!(!fs.is_file("/PharaohData/Data/Lazy.SG3"));
        assert!(fs.read("/PharaohData/Data/Lazy.SG3").is_none());
    }

    #[test]
    fn rename_of_a_lazy_entry_moves_its_bytes() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert!(fs.rename("/PharaohData/Data/Lazy.SG3", "/PharaohData/Data/Moved.SG3"));

        // The bytes were read once, by the rename: the new path has no file in the page,
        // so both reads of it answer from the store.
        assert_eq!(LAZY_CALLS.with(Cell::get), 1);
        assert_eq!(fs.read("/PharaohData/Data/Moved.SG3").as_deref(), Some(&b"read 1"[..]));
        assert_eq!(fs.read("/PharaohData/Data/Moved.SG3").as_deref(), Some(&b"read 1"[..]));
        assert_eq!(LAZY_CALLS.with(Cell::get), 1);
    }

    #[test]
    fn rename_of_a_folder_moves_its_lazy_files() {
        let mut fs = counting_fs();
        fs.mount_lazy("/PharaohData/Data/Lazy.SG3", 6);
        assert!(fs.rename("/PharaohData/Data", "/PharaohData/Old Data"));

        // The same rule as a single file: the bytes are read once, at the rename, because
        // the page has no file registered under the folder's new path.
        assert_eq!(fs.read("/PharaohData/Old Data/Lazy.SG3").as_deref(), Some(&b"read 1"[..]));
        assert_eq!(LAZY_CALLS.with(Cell::get), 1);
    }

    #[test]
    fn write_and_read() {
        let mut fs = MemFs::default();
        fs.write("/hello.txt", b"world".to_vec());
        assert_eq!(fs.read("/hello.txt").as_deref(), Some(&b"world"[..]));
    }

    #[test]
    fn read_missing_is_none() {
        let fs = MemFs::default();
        assert!(fs.read("/missing.txt").is_none());
    }

    #[test]
    fn case_insensitive_lookup() {
        let mut fs = MemFs::default();
        fs.mount("/G/Data/Pharaoh_Text.eng", b"data".to_vec());
        // Different casings all resolve to the same entry.
        assert_eq!(fs.read("/g/data/PHARAOH_TEXT.ENG").as_deref(), Some(&b"data"[..]));
        assert_eq!(fs.read("/G/DATA/pharaoh_text.eng").as_deref(), Some(&b"data"[..]));
    }

    #[test]
    fn read_dir_original_spelling_sorted() {
        let mut fs = MemFs::default();
        fs.mount("/data/Zebra.txt", b"z".to_vec());
        fs.mount("/data/alpha.txt", b"a".to_vec());
        fs.mount("/data/Middle.TXT", b"m".to_vec());

        let entries = fs.read_dir("/data");
        assert_eq!(entries.len(), 3);
        // Sorted by file name (case-insensitive via normalisation, but original spelling preserved).
        assert_eq!(entries[0].file_name(), "alpha.txt");
        assert_eq!(entries[1].file_name(), "Middle.TXT");
        assert_eq!(entries[2].file_name(), "Zebra.txt");
    }

    #[test]
    fn parent_dirs_exist_after_write() {
        let mut fs = MemFs::default();
        fs.write("/a/b/c/deep.txt", b"deep".to_vec());
        assert!(fs.is_dir_path("/a"));
        assert!(fs.is_dir_path("/a/b"));
        assert!(fs.is_dir_path("/a/b/c"));
    }

    #[test]
    fn rename() {
        let mut fs = MemFs::default();
        fs.write("/old.txt", b"content".to_vec());
        assert!(fs.rename("/old.txt", "/new.txt"));
        assert!(fs.read("/old.txt").is_none());
        assert_eq!(fs.read("/new.txt").as_deref(), Some(&b"content"[..]));
    }

    #[test]
    fn rename_missing_is_false() {
        let mut fs = MemFs::default();
        assert!(!fs.rename("/nope.txt", "/also_nope.txt"));
    }

    #[test]
    fn remove_dir_all() {
        let mut fs = MemFs::default();
        fs.write("/dir/a.txt", b"a".to_vec());
        fs.write("/dir/b.txt", b"b".to_vec());
        fs.write("/dir/sub/c.txt", b"c".to_vec());
        fs.remove_dir_all("/dir");
        assert!(fs.read("/dir/a.txt").is_none());
        assert!(fs.read("/dir/b.txt").is_none());
        assert!(fs.read("/dir/sub/c.txt").is_none());
    }

    #[test]
    fn modified_grows_with_write() {
        let mut fs = MemFs::default();
        fs.write("/file.txt", b"v1".to_vec());
        let seq1 = fs.modified_seq("/file.txt").unwrap();

        fs.write("/file.txt", b"v2".to_vec());
        let seq2 = fs.modified_seq("/file.txt").unwrap();
        assert!(seq2 > seq1);
    }

    #[test]
    fn dotdot_and_backslash_normalise() {
        let mut fs = MemFs::default();
        fs.write("/a/b/file.txt", b"ok".to_vec());
        // Use .. to navigate up.
        assert_eq!(fs.read("/a/c/../b/./file.txt").as_deref(), Some(&b"ok"[..]));
        // Backslashes.
        assert_eq!(fs.read(r"\a\b\file.txt").as_deref(), Some(&b"ok"[..]));
    }

    #[test]
    fn read_dir_returns_direct_children_only() {
        let mut fs = MemFs::default();
        fs.mount("/root/a.txt", b"a".to_vec());
        fs.mount("/root/sub/b.txt", b"b".to_vec());

        let entries = fs.read_dir("/root");
        // Both a.txt (file) and sub/ (directory) are direct children.
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].file_name(), "a.txt");
        assert!(entries[1].is_dir());
    }

    #[test]
    fn modified_returns_system_time() {
        let mut fs = MemFs::default();
        fs.write("/t.txt", b"x".to_vec());
        let seq = fs.modified_seq("/t.txt").unwrap();
        let time = SystemTime::UNIX_EPOCH + Duration::from_secs(seq);
        // Just verify it doesn't panic and is after epoch.
        assert!(time > SystemTime::UNIX_EPOCH);
    }

    // ── Change-tracking tests ───────────────────────────────────────

    #[test]
    fn write_records_put_under_prefix() {
        let mut fs = MemFs::default();
        fs.watch("/user");
        fs.write("/user/save.sav", b"save data".to_vec());
        let changes = fs.take_changes();
        assert_eq!(changes.len(), 1);
        match &changes[0] {
            Change::Put(path, data) => {
                assert_eq!(path, "/user/save.sav");
                assert_eq!(data.as_slice(), b"save data");
            }
            Change::Delete(_) => panic!("expected Put"),
        }
    }

    #[test]
    fn remove_file_records_delete() {
        let mut fs = MemFs::default();
        fs.write("/user/save.sav", b"save data".to_vec());
        fs.watch("/user");
        assert!(fs.remove_file("/user/save.sav"));
        let changes = fs.take_changes();
        assert_eq!(changes.len(), 1);
        match &changes[0] {
            Change::Delete(path) => assert_eq!(path, "/user/save.sav"),
            Change::Put(_, _) => panic!("expected Delete"),
        }
    }

    #[test]
    fn remove_file_missing_records_nothing() {
        let mut fs = MemFs::default();
        fs.watch("/user");
        assert!(!fs.remove_file("/user/nope.txt"));
        assert!(fs.take_changes().is_empty());
    }

    #[test]
    fn remove_dir_all_records_deletes() {
        let mut fs = MemFs::default();
        fs.write("/user/a.txt", b"a".to_vec());
        fs.write("/user/b.txt", b"b".to_vec());
        fs.write("/user/sub/c.txt", b"c".to_vec());
        fs.watch("/user");
        fs.remove_dir_all("/user");
        let changes = fs.take_changes();
        assert_eq!(changes.len(), 3);
        // All three should be Deletes.
        for c in &changes {
            match c {
                Change::Delete(_) => {}
                _ => panic!("expected Delete, got {:?}", c),
            }
        }
    }

    #[test]
    fn rename_file_records_both_sides() {
        let mut fs = MemFs::default();
        fs.write("/user/old.txt", b"content".to_vec());
        fs.watch("/user");
        assert!(fs.rename("/user/old.txt", "/user/new.txt"));
        let changes = fs.take_changes();
        assert_eq!(changes.len(), 2);
        match &changes[0] {
            Change::Delete(path) => assert_eq!(path, "/user/old.txt"),
            _ => panic!("expected Delete, got {:?}", changes[0]),
        }
        match &changes[1] {
            Change::Put(path, data) => {
                assert_eq!(path, "/user/new.txt");
                assert_eq!(data.as_slice(), b"content");
            }
            _ => panic!("expected Put, got {:?}", changes[1]),
        }
    }

    #[test]
    fn rename_one_side_under_prefix() {
        let mut fs = MemFs::default();
        fs.write("/user/file.txt", b"data".to_vec());
        fs.watch("/user");
        // Moving from /user to outside — only Delete recorded.
        assert!(fs.rename("/user/file.txt", "/other/file.txt"));
        let changes = fs.take_changes();
        assert_eq!(changes.len(), 1);
        match &changes[0] {
            Change::Delete(path) => assert_eq!(path, "/user/file.txt"),
            _ => panic!("expected Delete"),
        }

        // Reset and test the opposite direction.
        let mut fs2 = MemFs::default();
        fs2.write("/other/file.txt", b"data".to_vec());
        fs2.watch("/user");
        assert!(fs2.rename("/other/file.txt", "/user/file.txt"));
        let changes2 = fs2.take_changes();
        assert_eq!(changes2.len(), 1);
        match &changes2[0] {
            Change::Put(path, data) => {
                assert_eq!(path, "/user/file.txt");
                assert_eq!(data.as_slice(), b"data");
            }
            _ => panic!("expected Put"),
        }
    }

    #[test]
    fn mixed_case_paths_recorded_correctly() {
        let mut fs = MemFs::default();
        // Watch first, then write with mixed case.
        fs.watch("/user");
        fs.write("/User/Save.SAV", b"mixed".to_vec());
        let changes = fs.take_changes();
        assert_eq!(changes.len(), 1);
        match &changes[0] {
            Change::Put(path, data) => {
                // The original path casing is preserved.
                assert_eq!(path, "/User/Save.SAV");
                assert_eq!(data.as_slice(), b"mixed");
            }
            _ => panic!("expected Put"),
        }
    }

    #[test]
    fn nothing_recorded_without_watch() {
        let mut fs = MemFs::default();
        // No watch call — changes should not be recorded.
        fs.write("/user/file.txt", b"x".to_vec());
        assert!(fs.take_changes().is_empty());

        let mut fs2 = MemFs::default();
        fs2.watch("/other"); // watching a different prefix
        fs2.write("/user/file.txt", b"x".to_vec());
        assert!(fs2.take_changes().is_empty());
    }

    #[test]
    fn mount_and_create_dir_record_nothing() {
        let mut fs = MemFs::default();
        fs.watch("/user");
        fs.mount("/user/mounted.dat", b"mount data".to_vec());
        fs.create_dir_all("/user/some/dir");
        assert!(fs.take_changes().is_empty());
    }

    #[test]
    fn take_changes_clears_and_returns_oldest_first() {
        let mut fs = MemFs::default();
        fs.watch("/user");
        fs.write("/user/a.txt", b"a".to_vec());
        fs.write("/user/b.txt", b"b".to_vec());

        let c1 = fs.take_changes();
        assert_eq!(c1.len(), 2);
        match &c1[0] {
            Change::Put(path, _) => assert_eq!(path, "/user/a.txt"),
            _ => panic!("expected Put for a.txt"),
        }
        match &c1[1] {
            Change::Put(path, _) => assert_eq!(path, "/user/b.txt"),
            _ => panic!("expected Put for b.txt"),
        }

        // Second take should be empty.
        assert!(fs.take_changes().is_empty());
    }
}
