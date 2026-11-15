use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

/// A single entry in the in-memory file store.
#[derive(Debug)]
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
                data: Arc::from(data.into_boxed_slice()),
                seq: self.seq,
            },
        );
        for d in parent_dirs(&norm) {
            self.dirs.insert(d);
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

    /// Rename a file. Returns false if source does not exist.
    pub fn rename(&mut self, from: &str, to: &str) -> bool {
        let from_norm = normalise(from);
        let to_norm = normalise(to);
        if let Some(entry) = self.files.remove(&from_norm) {
            // Remove old parent dirs (they'll be re-added below).
            self.dirs.remove(&from_norm);
            self.seq += 1;
            self.files.insert(
                to_norm.clone(),
                Entry {
                    original: entry.original,
                    data: entry.data,
                    seq: self.seq,
                },
            );
            for d in parent_dirs(&to_norm) {
                self.dirs.insert(d);
            }
            true
        } else {
            false
        }
    }

    /// Remove a single file. Returns false if missing.
    pub fn remove_file(&mut self, path: &str) -> bool {
        self.files.remove(&normalise(path)).is_some()
    }

    /// Recursively remove everything under `path` (files and directories).
    pub fn remove_dir_all(&mut self, path: &str) {
        let prefix = normalise(path);
        // Remove files whose key starts with the directory prefix.
        let to_remove: Vec<String> = self
            .files
            .keys()
            .filter(|k| {
                if **k == prefix {
                    return false;
                }
                k.starts_with(&prefix) && k[prefix.len()..].starts_with('/')
            })
            .cloned()
            .collect();
        for k in to_remove {
            self.files.remove(&k);
        }
        // Remove directories whose key starts with the prefix (but not the dir itself).
        let to_remove_dirs: Vec<String> = self
            .dirs
            .iter()
            .filter(|k| **k != prefix && k.starts_with(&prefix))
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
}
