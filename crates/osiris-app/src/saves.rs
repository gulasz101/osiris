//! The player's saved games: where they live under `/user`, and moving them in and out.
//!
//! The browser keeps saves in IndexedDB and the desktop keeps them in a folder, but both go
//! through [`osiris_vfs`], so the list and the three file operations here are plain code that
//! builds for both targets. [`crate::web`] is the only thing that adds `wasm_bindgen` on top.

use std::path::{Path, PathBuf};

/// The largest save file the page will import. A city of the original is a few megabytes; this
/// leaves room for a big one and still refuses a file the browser would choke on.
pub const MAX_SAVE_BYTES: usize = 20 * 1024 * 1024;

/// The extension the game's own saves use, as `main.rs` `save_path` writes it.
const EXTENSION: &str = "osiris";

/// One saved game, as the Saves panel shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// The family whose folder holds the save, empty for a pre-family save.
    pub family: String,
    /// The file's name, for example `Nubt.osiris`.
    pub name: String,
    /// The full path under `/user`, which `read` and `delete` take back.
    pub path: String,
    /// The file's size in bytes.
    pub size: u64,
}

/// Every saved game under `user`: the pre-family `saves` folder and each family's own.
///
/// The family's display name comes from its `name.txt`, exactly as the menu's load screen
/// names it. A folder without one is named after the folder itself.
pub fn list(user: &Path) -> Vec<Entry> {
    let mut entries = Vec::new();
    collect(&mut entries, user.join("saves"), "");
    if let Ok(rd) = osiris_vfs::read_dir(user.join("families")) {
        for dir in rd.into_iter().filter(|e| e.is_dir) {
            let family = crate::family_display_name(&dir.path_buf());
            collect(&mut entries, dir.path_buf().join("saves"), &family);
        }
    }
    entries.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    entries
}

/// Adds the saves directly inside `saves` to `entries`, under `family`.
fn collect(entries: &mut Vec<Entry>, saves: PathBuf, family: &str) {
    let Ok(rd) = osiris_vfs::read_dir(&saves) else { return };
    for e in rd.into_iter().filter(|e| !e.is_dir) {
        let path = e.path_buf();
        if !is_save(&path) {
            continue;
        }
        let name = path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let size = osiris_vfs::len(&path).unwrap_or(0);
        entries.push(Entry {
            family: family.to_owned(),
            name,
            path: path.to_string_lossy().into_owned(),
            size,
        });
    }
}

/// Whether a path is one of the game's saves, as `main.rs` `list_files` decides it.
fn is_save(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
        && !path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('_'))
}

/// The bytes of the save at `path`, which must be a save the list covers.
pub fn read(user: &Path, path: &str) -> Result<Vec<u8>, String> {
    let path = checked_path(user, path)?;
    osiris_vfs::read(&path).map_err(|e| format!("could not read {}: {e}", path.display()))
}

/// Writes `bytes` as `name` into `saves_dir`, the active family's saves folder.
///
/// Refuses a name that is not a plain `.osiris` file name, and a file over [`MAX_SAVE_BYTES`].
/// Returns the path written.
pub fn write(saves_dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = checked_name(name)?;
    if bytes.len() > MAX_SAVE_BYTES {
        return Err(format!(
            "{} is {} bytes; the page imports up to {} MB",
            name,
            bytes.len(),
            MAX_SAVE_BYTES / (1024 * 1024)
        ));
    }
    osiris_vfs::create_dir_all(saves_dir)
        .map_err(|e| format!("could not make {}: {e}", saves_dir.display()))?;
    let path = saves_dir.join(name);
    osiris_vfs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path)
}

/// Removes the save at `path`, which must be a save the list covers.
pub fn delete(user: &Path, path: &str) -> Result<(), String> {
    let path = checked_path(user, path)?;
    osiris_vfs::remove_file(&path).map_err(|e| format!("could not delete {}: {e}", path.display()))
}

/// Checks that `path` is a save directly inside one of `user`'s saves folders, and returns it.
fn checked_path(user: &Path, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !is_save(&path) {
        return Err(format!("{path:?} is not a saved game"));
    }
    let parent = path.parent().unwrap_or(Path::new(""));
    if parent == user.join("saves") || is_family_saves(user, parent) {
        Ok(path)
    } else {
        Err(format!("{path:?} is not in one of the saves folders"))
    }
}

/// Whether `dir` is a family's saves folder: `<user>/families/<one folder>/saves`.
fn is_family_saves(user: &Path, dir: &Path) -> bool {
    let Ok(rest) = dir.strip_prefix(user.join("families")) else { return false };
    let parts: Vec<_> = rest.components().collect();
    parts.len() == 2 && parts[1].as_os_str().eq_ignore_ascii_case("saves")
}

/// Checks that `name` is a plain save file name, and returns it trimmed.
fn checked_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("the chosen file has no name".to_owned());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("{name} is not a plain file name: it holds a path"));
    }
    if !name.to_ascii_lowercase().ends_with(&format!(".{EXTENSION}")) {
        return Err(format!("{name} is not a saved game (.{EXTENSION})"));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder under the temporary directory, empty when the test starts.
    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osiris-saves-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// The issue's test: a save the desktop path wrote comes back out of the web unchanged.
    ///
    /// The desktop game writes its save with `osiris_vfs::write` (see `quicksave` in `main.rs`),
    /// and the browser's `read_save`/`write_save` are [`read`] and [`write`] underneath, so this
    /// runs the same bytes through the same code on this machine.
    #[test]
    fn a_desktop_save_goes_through_the_web_and_comes_back_unchanged() {
        let user = temp("round-trip");
        let desktop = user.join("families/nubt/saves");
        osiris_vfs::create_dir_all(&desktop).unwrap();
        // The save format is the game's; the bytes are made up here, never a game file.
        let bytes: Vec<u8> = (0..8192u32).map(|i| (i % 251) as u8).collect();
        osiris_vfs::write(desktop.join("Nubt.osiris"), &bytes).unwrap();
        osiris_vfs::write(user.join("families/nubt/name.txt"), "Smoke").unwrap();
        // A setting beside the saves is not a save and never appears in the list.
        osiris_vfs::write(user.join("rules.toml"), "x = 1\n").unwrap();

        let entries = list(&user);
        assert_eq!(entries.len(), 1, "the list: {entries:?}");
        let entry = &entries[0];
        assert_eq!(entry.family, "Smoke");
        assert_eq!(entry.name, "Nubt.osiris");
        assert_eq!(entry.size, bytes.len() as u64);

        // Out through the page's read, and back in through its write.
        let read_back = read(&user, &entry.path).unwrap();
        assert_eq!(read_back, bytes);
        let other = user.join("families/other/saves");
        let written = write(&other, "Copied.osiris", &read_back).unwrap();
        assert_eq!(written, other.join("Copied.osiris"));
        assert_eq!(osiris_vfs::read(&written).unwrap(), bytes, "the bytes changed on the way");

        // The copy is in the list too, under the folder's own name (it has no name.txt).
        let families: Vec<String> = list(&user).into_iter().map(|e| e.family).collect();
        assert_eq!(families, ["Smoke", "other"]);

        let _ = std::fs::remove_dir_all(&user);
    }

    #[test]
    fn only_a_save_in_a_saves_folder_is_read_or_deleted() {
        let user = temp("refusals");
        osiris_vfs::create_dir_all(user.join("families/smoke/saves")).unwrap();
        osiris_vfs::write(user.join("families/smoke/saves/Nubt.osiris"), b"save").unwrap();
        osiris_vfs::write(user.join("rules.toml"), b"x = 1\n").unwrap();
        osiris_vfs::write(user.join("families/smoke/name.txt"), b"Smoke").unwrap();

        let good = user.join("families/smoke/saves/Nubt.osiris").to_string_lossy().into_owned();
        assert!(read(&user, &good).is_ok());
        for bad in [
            user.join("rules.toml").to_string_lossy().into_owned(),
            user.join("families/smoke/name.txt").to_string_lossy().into_owned(),
            user.join("families/smoke/Nubt.osiris").to_string_lossy().into_owned(),
            user.join("saves/Nubt.osiris").to_string_lossy().into_owned(),
            user.join("families/smoke/saves/deeper/Nubt.osiris").to_string_lossy().into_owned(),
        ] {
            assert!(read(&user, &bad).is_err(), "read took {bad}");
            assert!(delete(&user, &bad).is_err(), "delete took {bad}");
        }

        assert!(delete(&user, &good).is_ok());
        assert!(list(&user).is_empty());
        let _ = std::fs::remove_dir_all(&user);
    }

    #[test]
    fn an_imported_name_must_be_a_plain_save_name() {
        let dir = temp("names");
        for bad in ["", "  ", "../escape.osiris", "sub/Nubt.osiris", "sub\\Nubt.osiris", "Nubt.txt", "a..b.osiris"] {
            assert!(write(&dir, bad, b"save").is_err(), "write took {bad:?}");
        }
        assert!(write(&dir, "Nubt.osiris", b"save").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_import_over_twenty_megabytes_is_refused() {
        let dir = temp("big");
        let big = vec![0u8; MAX_SAVE_BYTES + 1];
        let refused = write(&dir, "Big.osiris", &big);
        assert!(refused.is_err());
        match osiris_vfs::read_dir(&dir) {
            Ok(rd) => assert!(rd.is_empty(), "a refused import wrote something"),
            Err(_) => {}
        }
        assert!(write(&dir, "Fits.osiris", &vec![0u8; MAX_SAVE_BYTES]).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
