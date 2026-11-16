# web-persist Specification

## Purpose
Keep the player's own files after a page reload: everything the game writes under `/user` is stored in the browser's IndexedDB and is back in the in-memory store the next time the page loads.

## Requirements

### Requirement: User files survive a page reload
In the browser, every file the game writes under `/user` SHALL be stored in IndexedDB and SHALL be back in the in-memory store after the page is loaded again.

#### Scenario: file kept after reload
- GIVEN the page open in Chromium
- WHEN the game writes `/user/smoke.txt` with the text `kept` and the page is reloaded
- THEN reading `/user/smoke.txt` returns `kept`

#### Scenario: deleted file stays deleted
- GIVEN a stored file `/user/saves/a.osiris`
- WHEN the game removes it and the page is reloaded
- THEN `/user/saves/a.osiris` does not exist

### Requirement: Only user files are recorded
The change log SHALL record only paths under the watched prefix, and SHALL record nothing when no prefix is watched.

#### Scenario: game data is not stored
- GIVEN `/user` is watched
- WHEN the page mounts `/PharaohData/Data/Pharaoh_General.sg3`
- THEN no change is recorded
