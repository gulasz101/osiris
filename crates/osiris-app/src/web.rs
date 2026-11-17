//! Browser entry point for Osiris on wasm32.

use std::cell::Cell;
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use wasm_bindgen::prelude::*;

// ── How long the start took ────────────────────────────────────────

thread_local! {
    /// When the player picked their folder (or when the page loaded, if the files came
    /// from browser storage), in `performance.now()` milliseconds. The pick happens in
    /// `main.js` and the main menu is built in the program, so the time is handed over once.
    static PICK_AT: Cell<Option<f64>> = const { Cell::new(None) };
}

/// Remember when the player picked their folder, in `performance.now()` milliseconds
/// (browser only; `main.js` calls this when the page loads and again at every pick).
#[wasm_bindgen]
pub fn set_pick_time(at: f64) {
    PICK_AT.with(|cell| cell.set(Some(at)));
}

/// Milliseconds from the pick to now, or `None` when nothing set the time.
pub fn since_pick_ms() -> Option<f64> {
    let at = PICK_AT.with(|cell| cell.get())?;
    let now = web_sys::window()?.performance()?.now();
    Some((now - at).max(0.0))
}

// ── Debug audio for the smoke test ──────────────────────────────────

thread_local! {
    /// The audio the smoke test opened, kept here so it lives as long as the page does.
    /// The game opens its own when it starts; this is only for the test.
    static DEBUG_AUDIO: RefCell<Option<osiris_audio::Audio>> = const { RefCell::new(None) };
}

thread_local! {
    /// The menu page's clickable buttons as JSON, filled by `menu.rs` as it draws and read
    /// by the smoke test so it can click the menu the way a player does.
    static MENU_BUTTONS: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Keeps the buttons of the menu page drawn last (browser only, `menu.rs` calls this).
pub fn set_menu_buttons(json: String) {
    MENU_BUTTONS.with(|cell| *cell.borrow_mut() = json);
}

/// The buttons of the menu page drawn last, as JSON:
/// `[{"action":"Go(Campaign)","label":"Begin Family History","x":..,"y":..,"w":..,"h":..}]`,
/// in the canvas's pixels, for the smoke test. Empty when no menu is on screen.
#[wasm_bindgen]
pub fn debug_menu_buttons() -> String {
    MENU_BUTTONS.with(|cell| cell.borrow().clone())
}

/// Open the default audio output device and keep it (browser, smoke test only).
///
/// Returns `true` when a device opened: on a browser without an audio output this is
/// `false`, and playback stays silent, exactly as the game's own `Audio::new` does.
#[wasm_bindgen]
pub fn debug_audio_open() -> bool {
    match osiris_audio::Audio::new(std::path::Path::new("/PharaohData")) {
        Ok(audio) => {
            let has_output = audio.has_output();
            log::info!("osiris web: debug_audio_open - has_output {has_output}");
            DEBUG_AUDIO.with(|cell| *cell.borrow_mut() = Some(audio));
            has_output
        }
        Err(err) => {
            log::warn!("osiris web: debug_audio_open failed: {err}");
            false
        }
    }
}

/// Play a generated beep from the in-memory store (browser, smoke test only).
///
/// The WAV is built in [`crate::beep`], so no game file is needed to hear whether the
/// browser build has sound.
#[wasm_bindgen]
pub fn debug_audio_beep() {
    const PATH: &str = "/PharaohData/AUDIO/Wavs/osiris_beep.wav";
    if let Err(err) = osiris_vfs::write(PATH, crate::beep::beep_wav()) {
        log::warn!("osiris web: debug_audio_beep - could not write {PATH}: {err}");
        return;
    }
    DEBUG_AUDIO.with(|cell| match cell.borrow().as_ref() {
        Some(audio) => audio.play_effect("osiris_beep.wav"),
        None => log::warn!("osiris web: debug_audio_beep - no audio opened, call debug_audio_open"),
    });
}

// ── The soak run: frames, memory and the editor's state ────────────

thread_local! {
    /// Whether the soak run's log lines are on. A player's console stays quiet out of
    /// sight; the smoke test's `SMOKE_SOAK=1` turns them on before the city starts.
    static SOAK: Cell<bool> = const { Cell::new(false) };
}

/// Turns the soak run's log lines on or off (browser only; the smoke test calls this).
#[wasm_bindgen]
pub fn set_soak(on: bool) {
    SOAK.with(|cell| cell.set(on));
}

/// Whether the soak run's log lines are on (`main.rs` asks before it logs).
pub fn soak() -> bool {
    SOAK.with(Cell::get)
}

/// The wasm instance's memory size in bytes, from `WebAssembly.Memory.buffer.byteLength`
/// (browser only, for the soak run).
///
/// `wasm_bindgen::memory()` hands back this instance's `WebAssembly.Memory`, which the page's
/// own JavaScript cannot reach. The size comes back as a `f64` because that is what the page's
/// `byteLength` is, so nothing rounds it on the way out.
#[wasm_bindgen]
pub fn memory_bytes() -> f64 {
    let memory = wasm_bindgen::memory();
    let Ok(buffer) = js_sys::Reflect::get(&memory, &JsValue::from_str("buffer")) else {
        return 0.0;
    };
    js_sys::Reflect::get(&buffer, &JsValue::from_str("byteLength"))
        .ok()
        .and_then(|size| size.as_f64())
        .unwrap_or(0.0)
}

thread_local! {
    /// The Mission Editor's state as JSON, filled by `main.rs` as the editor draws and read
    /// by the smoke test, which cannot see the editor's own fields.
    static DEBUG_EDITOR: RefCell<String> = const { RefCell::new(String::new()) };

    /// The city's state as JSON, filled by `main.rs` as the city draws and read by the smoke
    /// test, which cannot see the game's own fields (web-soak).
    static DEBUG_CITY: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Keeps the city state drawn last, for the smoke test (browser only, `main.rs` calls this).
pub fn set_debug_city(json: String) {
    DEBUG_CITY.with(|cell| *cell.borrow_mut() = json);
}

/// The city's state as JSON, the way `main.rs` last built it: `{"idle":true,"lost":false,
/// "paused":false,"messages":0,"dialog":false,"confirm":false,"custom":false,
/// "tool":"none"}`.
#[wasm_bindgen]
pub fn debug_city() -> String {
    DEBUG_CITY.with(|cell| cell.borrow().clone())
}

/// Keeps the editor state drawn last, for the smoke test (browser only, `main.rs` calls this).
pub fn set_debug_editor(json: String) {
    DEBUG_EDITOR.with(|cell| *cell.borrow_mut() = json);
}

/// The Mission Editor's state as JSON, the way `main.rs` last built it:
/// `{"name":"Small Oasis","dirty":true,"path":null,"status":"Saved ...","popup":"save-name",
/// "tool":"paint"}`.
#[wasm_bindgen]
pub fn debug_editor() -> String {
    DEBUG_EDITOR.with(|cell| cell.borrow().clone())
}

// ── IndexedDB store bindings (browser only) ────────────────────────

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = osirisStore, js_name = put)]
    fn store_put(path: &str, bytes: &[u8]);

    #[wasm_bindgen(js_namespace = osirisStore, js_name = del)]
    fn store_del(path: &str);
}

// ── Lazy game files (browser only) ─────────────────────────────────

#[wasm_bindgen]
extern "C" {
    /// The page's one reader of a game file's bytes (`web/files.js`), synchronous.
    ///
    /// It throws when the page has no file under that path, which `catch` hands back as
    /// `Err` instead of unwinding through the game.
    #[wasm_bindgen(catch, js_namespace = osirisFiles, js_name = read)]
    fn files_read(path: &str) -> Result<Vec<u8>, JsValue>;
}

/// Read a game file the page holds outside wasm memory (browser only).
///
/// `osiris-vfs` calls this for a lazy entry, with the exact path the page registered the
/// file under. The bytes go straight back to the game and the store keeps nothing, so a
/// file the game reads twice is read from the browser twice. A failed read is a warning
/// and reads as a missing file.
fn lazy_read(path: &str) -> Option<Vec<u8>> {
    match files_read(path) {
        Ok(bytes) => Some(bytes),
        Err(err) => {
            log::warn!("osiris web: reading {path} failed: {err:?}");
            None
        }
    }
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

    // A lazy game file's bytes come from the page's own copy of the file.
    osiris_vfs::set_lazy_reader(lazy_read);
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
/// The VFS path a picked file mounts at: its first folder becomes the virtual root.
fn vfs_path(path: &str) -> String {
    let mut parts = path.splitn(2, '/');
    let folder = parts.next().unwrap_or_default();
    match parts.next() {
        Some(remaining) if !remaining.is_empty() => format!("/{}/{}", folder, remaining),
        _ => format!("/{}", folder),
    }
}

#[wasm_bindgen]
pub fn mount_file(path: String, bytes: Vec<u8>) {
    osiris_vfs::mount(&vfs_path(&path), bytes);
}

/// Mount a game file the page keeps outside wasm memory (browser only).
///
/// `path` is the file's path in the picked folder (e.g. `"PharaohData/Data/x.sg3"`) and is
/// transformed the same way as [`mount_file`]. `len` is the file's size, which is all the
/// store is told: the bytes stay where the browser has them and are read when the game
/// opens the file (see [`lazy_read`]).
#[wasm_bindgen]
pub fn mount_lazy(path: String, len: f64) {
    osiris_vfs::mount_lazy(&vfs_path(&path), len as u64);
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

// ── The Saves panel: list, read, write and delete under /user ──────

/// Every saved game under `/user`, as JSON for the page's Saves panel:
/// `[{"family":"Smoke","name":"Nubt.osiris","path":"/user/families/smoke/saves/Nubt.osiris","size":184321}]`.
#[wasm_bindgen]
pub fn list_saves() -> String {
    crate::saves::json(&crate::saves::list(Path::new("/user")))
}

/// The bytes of one saved game, for the panel's Download button.
///
/// Refuses a path outside `/user/` and one that is not a save inside a saves folder.
#[wasm_bindgen]
pub fn read_save(path: String) -> Result<Vec<u8>, JsValue> {
    let path = user_path(&path)?;
    crate::saves::read(Path::new("/user"), path).map_err(|e| JsValue::from_str(&e))
}

/// Writes `bytes` as `name` into the active family's saves folder, and returns the path written.
///
/// The write goes through `osiris_vfs`, so `init`'s `/user` change hook puts it in IndexedDB
/// exactly as a save made by the game does: one write path, not a second one for imports.
#[wasm_bindgen]
pub fn write_save(name: String, bytes: Vec<u8>) -> Result<String, JsValue> {
    let dir = crate::player_saves_dir();
    let written = crate::saves::write(&dir, &name, &bytes).map_err(|e| JsValue::from_str(&e))?;
    let path = written.to_string_lossy().into_owned();
    user_path(&path)?;
    Ok(path)
}

/// Removes one saved game, for the panel's Delete button.
#[wasm_bindgen]
pub fn delete_save(path: String) -> Result<(), JsValue> {
    let path = user_path(&path)?;
    crate::saves::delete(Path::new("/user"), path).map_err(|e| JsValue::from_str(&e))
}

/// `path` when it is under `/user/`, else the error the page shows.
fn user_path(path: &str) -> Result<&str, JsValue> {
    if path.starts_with("/user/") {
        Ok(path)
    } else {
        Err(JsValue::from_str(&format!("{path} is not under /user/")))
    }
}

/// The page canvas's bitmap size, as `main.js` `fitCanvas` left it: the window's size in
/// device pixels. Falls back to the game's minimum when the page has no canvas or has not
/// sized it yet, so the game always has something to draw into.
fn canvas_size() -> (u32, u32) {
    let canvas = web_sys::window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id("osiris"))
        .and_then(|el| el.dyn_into::<web_sys::HtmlCanvasElement>().ok());
    let Some(canvas) = canvas else {
        return (1024, 768);
    };
    if canvas.width() < 2 || canvas.height() < 2 {
        return (1024, 768);
    }
    (canvas.width(), canvas.height())
}

/// Start the game. The page must have called [`mount_file`] for every file in the
/// player's chosen Pharaoh folder first.
///
/// Fails with a readable message if `/PharaohData/Data` does not exist (the wrong
/// folder was picked). Otherwise calls the same `run` function as the desktop build,
/// passing `--data /PharaohData`.
///
/// `mission` is the mission to start, as the desktop's `--mission N`; `undefined`
/// (or `null`) starts at the main menu.
#[wasm_bindgen]
pub fn start_game(mission: Option<u32>) -> Result<(), JsValue> {
    if !osiris_vfs::is_dir("/PharaohData/Data") {
        return Err(
            "This folder does not hold Pharaoh's Data folder. Choose the folder that contains \
             Pharaoh.exe (the GOG or Steam installation of Pharaoh + Cleopatra)."
                .into(),
        );
    }

    log::info!("osiris web: start_game - /PharaohData/Data exists, calling run()");

    // The game's size is the page's canvas, which `main.js` sized for the window. There is
    // no fixed size of our own on the web.
    let (width, height) = canvas_size();

    let args = crate::Args {
        data: Some(PathBuf::from("/PharaohData")),
        map: None,
        mission: mission.map(|m| m as usize),
        screenshot: None,
        script: None,
        size: (width, height),
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
