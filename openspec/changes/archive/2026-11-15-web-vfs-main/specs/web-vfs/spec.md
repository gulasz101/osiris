# Delta for web-vfs

## ADDED Requirements

### Requirement: No direct file calls in the browser build
Non-test code of every crate the browser build uses SHALL reach files only through `osiris-vfs`, and `scripts/check.sh` SHALL fail when a direct call comes back.

#### Scenario: gate catches a new direct call
- GIVEN a new `std::fs::read` line in `crates/osiris-app/src/game.rs` outside the tests
- WHEN `scripts/check.sh` runs
- THEN it fails at the no-direct-fs step

### Requirement: Browser user folder
In the browser, saves and settings SHALL be stored under `/user` in the in-memory store; on desktop the user folder is unchanged.

#### Scenario: desktop user folder
- GIVEN the desktop build on macOS
- WHEN the game saves its settings
- THEN they land in `~/Library/Application Support/Osiris` as before
