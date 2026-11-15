# web-vfs Specification

## Purpose
Provide a single file access layer (`osiris_vfs`) that uses `std::fs` on desktop and an in-memory store in the browser, so no crate other than `osiris-app` calls `std::fs` directly.

## Requirements

### Requirement: One file layer
All file access in non-test code of `osiris-formats`, `osiris-sim`, `osiris-audio` and `osiris-bink` SHALL go through the `osiris-vfs` crate, which uses `std::fs` on desktop and an in-memory store in the browser.

#### Scenario: no direct calls left
- GIVEN the repo after this change
- WHEN `scripts/no-direct-fs.sh crates/osiris-formats/src crates/osiris-sim/src crates/osiris-audio/src crates/osiris-bink/src` runs
- THEN it prints `no-direct-fs: OK`

### Requirement: Case-insensitive in-memory store
The in-memory store SHALL find a file whatever the case of its path, and SHALL list directory entries with the spelling they were stored with.

#### Scenario: mixed-case game file
- GIVEN a file mounted as `/G/Data/Pharaoh_Text.eng`
- WHEN the code reads `/g/data/PHARAOH_TEXT.ENG`
- THEN it gets the mounted bytes
- AND `read_dir("/g/data")` lists `Pharaoh_Text.eng`
