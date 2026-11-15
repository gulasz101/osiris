//! Browser entry point for Osiris on wasm32.

use std::path::PathBuf;
use wasm_bindgen::prelude::*;

/// Set up panic hook and logger for the browser environment.
pub fn init() {
    console_error_panic_hook::set_once();
    static LOGGER: WebLogger = WebLogger;

    log::set_logger(&LOGGER)
        .map(|()| log::set_max_level(log::LevelFilter::Info))
        .expect("web logger should only be installed once");
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
/// `/PharaohData/Data/Pharaoh_General.sg3`.
///
/// [`webkitRelativePath`]: https://developer.mozilla.org/en-US/docs/Web/API/File/webkitRelativePath
#[wasm_bindgen]
pub fn mount_file(path: String, bytes: Vec<u8>) {
    let mut parts = path.splitn(2, '/');
    if let Some(folder) = parts.next() {
        let remaining = parts.next().unwrap_or("");
        let vfs_path = format!("/{}{}", folder, remaining);
        osiris_vfs::mount(&vfs_path, bytes);
    }
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

    crate::run(args)
        .map_err(|e| JsValue::from_str(&format!("{e:#}")))
}
