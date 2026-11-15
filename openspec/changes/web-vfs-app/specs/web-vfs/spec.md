# Delta for web-vfs

## ADDED Requirements

### Requirement: App files use the file layer
Non-test code in `crates/osiris-app/src`, except `main.rs`, SHALL reach files only through `osiris-vfs`.

#### Scenario: only main.rs left
- GIVEN the repo after this change
- WHEN `scripts/no-direct-fs.sh crates/osiris-app/src` runs
- THEN every line it prints is in `crates/osiris-app/src/main.rs`
