//! Browser entry point for Osiris on wasm32.

use log::{Level, Record};

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

    fn log(&self, record: &Record) {
        let msg = record.args().to_string();
        match record.level() {
            Level::Error | Level::Warn => web_sys::console::warn_1(&msg.into()),
            _ => web_sys::console::log_1(&msg.into()),
        }
    }

    fn flush(&self) {}
}
