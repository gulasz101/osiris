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

/// A single entry in the in-memory file store.
#[derive(Debug, Clone)]
struct Entry {
    /// The original path as given at mount/write time (for DirEntry display).
    original: String,
    /// The file bytes.
    data: Arc<[u8]>,
    /// Monotonically increasing write counter (used for modified timestamps).
    seq: u64,
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
    /// Directory keys (normalised paths).
    dirs: BTreeSet<String>,
    /// Monotonic counter for `modified` timestamps.
    seq: u64,
    /// Normalised prefix being watched for changes (e.g. "/user"), or `None`.
    watch_prefix: Option<String>,
    /// Recorded changes since the last call to [`Self::take_changes`].
    changes: Vec<Change>,
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
                data: Arc::from(data.into_boxed_slice()),
                seq: self.seq,
            },
        );
        for d in parent_dirs(&norm) {
            self.dirs.insert(d);
        }
    }

    /// Write bytes to a path (creates parent directories implicitly).
    pub fn write(&mut self, path: &str, data: Vec<u8>) {
        let norm = normalise(path);
        self.seq += 1;
        self.files.insert(
            norm.clone(),
            Entry {
                original: path.to_owned(),
                data: Arc::from(data.clone().into_boxed_slice()),
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
    pub fn read(&self, path: &str) -> Option<Arc<[u8]>> {
        self.files.get(&normalise(path)).map(|e| e.data.clone())
    }

    /// Rename a file or directory. Returns false if source does not exist.
    pub fn rename(&mut self, from: &str, to: &str) -> bool {
        let from_norm = normalise(from);
        let to_norm = normalise(to);

        // Check whether `from` is a directory (has files under it).
        let has_children = self.files.keys().any(|k| is_under(k, &from_norm));

        if has_children {
            // Directory rename: move all files and directories under `from` to under `to`.
            let children: Vec<(String, Entry)> = self
                .files
                .iter()
                .filter(|(k, _)| is_under(k, &from_norm))
                .map(|(k, v)| (k.clone(), (*v).clone()))
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
                        self.changes.push(Change::Put(new_original, entry.data.as_ref().to_vec()));
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
            // Single-file rename (existing behaviour).
            let entry = self.files.remove(&from_norm).unwrap();
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
                    self.changes.push(Change::Put(to.to_owned(), entry.data.as_ref().to_vec()));
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
    use std::time::{Duration, SystemTime};

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
