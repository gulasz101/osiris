# web-runtime Specification

## Purpose
TBD - created by archiving change web-time-threads. Update Purpose after archive.

## Requirements

### Requirement: Browser-safe clock
Non-test code in `osiris-app` and `osiris-ui` SHALL read the clock only through `web_time`, so that no clock call panics in the browser.

#### Scenario: frame timing in the browser
- GIVEN the wasm build running in a browser
- WHEN a frame is drawn
- THEN no "time not implemented on this platform" panic appears in the console

### Requirement: No threads in the browser
On wasm the program SHALL NOT call `std::thread::spawn`; autosaves are written on the calling thread and movies are skipped.

#### Scenario: autosave in the browser
- GIVEN the wasm build at the start of a new month with autosave on
- WHEN the autosave runs
- THEN it is written without starting a thread

#### Scenario: desktop autosave unchanged
- GIVEN the desktop build
- WHEN `cargo test -p osiris-app autosaves_rotate` runs
- THEN it passes
