//! Browser entry point for Osiris on wasm32.

use std::path::PathBuf;
use wasm_bindgen::prelude::*;

// ── IndexedDB store bindings (browser only) ────────────────────────

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = osirisStore, js_name = put)]
    fn store_put(path: &str, bytes: &[u8]);

    #[wasm_bindgen(js_namespace = osirisStore, js_name = del)]
    fn store_del(path: &str);
}

/// The change-callback used by the VFS hook.
fn on_change(change: osiris_vfs::Change) {
    match change {
        osiris_vfs::Change::Put(path, data) => store_put(&path, &data),
        osiris_vfs::Change::Delete(path) => store_del(&path),
    }
}

/// Set up panic hook and logger for the browser environment.
pub fn init() {
    console_error_panic_hook::set_once();
    static LOGGER: WebLogger = WebLogger;

    log::set_logger(&LOGGER)
        .map(|()| log::set_max_level(log::LevelFilter::Info))
        .expect("web logger should only be installed once");

    // Watch /user so writes are recorded, and connect the hook to IndexedDB.
    osiris_vfs::watch("/user");
    osiris_vfs::set_change_hook(on_change);
}

/// A [`log`] subscriber that forwards records to the browser console.
struct WebLogger;

impl log::Log for WebLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        let msg = record.args().to_string();
        match record.level() {
            log::Level::Error | log::Level::Warn => web_sys::console::warn_1(&msg.into()),
            _ => web_sys::console::log_1(&msg.into()),
        }
    }

    fn flush(&self) {}
}

/// Mount a single file from the player's chosen folder into the in-memory VFS.
///
/// `path` is the file's [`webkitRelativePath`] (e.g. `"Pharaoh/Data/Pharaoh_General.sg3"`).
/// The first path component becomes the virtual root, so this mounts at
/// `/Pharaoh/Data/Pharaoh_General.sg3`.
///
/// [`webkitRelativePath`]: https://developer.mozilla.org/en-US/docs/Web/API/File/webkitRelativePath
#[wasm_bindgen]
pub fn mount_file(path: String, bytes: Vec<u8>) {
    let mut parts = path.splitn(2, '/');
    if let Some(folder) = parts.next() {
        let remaining = parts.next().unwrap_or("");
        let vfs_path = if remaining.is_empty() {
            format!("/{}", folder)
        } else {
            format!("/{}/{}", folder, remaining)
        };
        osiris_vfs::mount(&vfs_path, bytes);
    }
}

/// Mount a single file at an exact VFS path (no transformation).
///
/// For the smoke test only — allows mounting game data at `/PharaohData/...`.
#[wasm_bindgen]
pub fn mount_exact(vfs_path: String, bytes: Vec<u8>) {
    osiris_vfs::mount(&vfs_path, bytes);
}

/// Mount a single user file into the store (browser only).
///
/// Called by `main.js` to restore persisted files before the game starts.
/// Only accepts paths starting with `/user/`; other paths are rejected with a warning.
#[wasm_bindgen]
pub fn mount_user_file(path: String, bytes: Vec<u8>) {
    if !path.starts_with("/user/") {
        log::warn!("mount_user_file: path does not start with /user/: {}", path);
        return;
    }
    osiris_vfs::mount(&path, bytes);
}

/// Write a text file under `/user/<name>` (browser only).
///
/// For the smoke test only.
#[wasm_bindgen]
pub fn debug_write_user(name: String, text: String) {
    let path = format!("/user/{}", name);
    osiris_vfs::write(&path, text.into_bytes());
}

/// Read a file under `/user/<name>` (browser only).
///
/// For the smoke test only.
#[wasm_bindgen]
pub fn debug_read_user(name: String) -> Option<String> {
    let path = format!("/user/{}", name);
    osiris_vfs::read(&path)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes.to_vec()).ok())
}

/// Start the game. The page must have called [`mount_file`] for every file in the
/// player's chosen Pharaoh folder first.
///
/// Fails with a readable message if `/PharaohData/Data` does not exist (the wrong
/// folder was picked). Otherwise calls the same `run` function as the desktop build,
/// passing `--data /PharaohData`.
#[wasm_bindgen]
pub fn start_game() -> Result<(), JsValue> {
    if !osiris_vfs::is_dir("/PharaohData/Data") {
        return Err(
            "This folder does not hold Pharaoh's Data folder. Choose the folder that contains \
             Pharaoh.exe (the GOG or Steam installation of Pharaoh + Cleopatra)."
                .into(),
        );
    }

    log::info!("osiris web: start_game - /PharaohData/Data exists, calling run()");

    let args = crate::Args {
        data: Some(PathBuf::from("/PharaohData")),
        map: None,
        mission: None,
        screenshot: None,
        script: None,
        size: (1280, 768),
        size_given: false,
        replay: None,
        lang: None,
    };

    log::info!("osiris web: start_game - args prepared, about to call crate::run()");
    let result = crate::run(args);
    match &result {
        Ok(_) => log::info!("osiris web: run() returned Ok"),
        Err(e) => log::warn!("osiris web: run() returned error: {e:#}"),
    }

    result.map_err(|e| JsValue::from_str(&format!("{e:#}")))
}
