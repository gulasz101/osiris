# web-root Specification

## Purpose
The player may pick their whole GOG folder, not only the folder that holds `Pharaoh.exe`.
`web/folder.js` finds the game root inside whatever was picked, and only the files under that root
are read and mounted under `/PharaohData`.

## Requirements

### Requirement: The page finds the game root inside the chosen folder
Before reading any file bytes, the page SHALL look through the list of paths the folder walker produced and SHALL take as the game root the shortest directory prefix `P` for which `P + "Data/Pharaoh_General.sg3"` is one of the paths, comparing names case-insensitively. It SHALL be the same code for the folder picker and for a folder dragged onto the page, and `web/folder.js` SHALL export it as `findGameRoot(list)`.

#### Scenario: the chosen folder is the root
- GIVEN paths `Data/Pharaoh_General.sg3` and `Data/Pharaoh_Text.eng`
- WHEN `findGameRoot` runs
- THEN it returns `""`

#### Scenario: one folder above the root
- GIVEN paths `Pharaoh/Data/Pharaoh_General.sg3`
- WHEN `findGameRoot` runs
- THEN it returns `Pharaoh/`

#### Scenario: the GOG folder with the game two levels down
- GIVEN paths `pharaoh-plus-cleopatra/Akhenaten/resources/Data/Pharaoh_General.sg3`
- WHEN `findGameRoot` runs
- THEN it returns `pharaoh-plus-cleopatra/Akhenaten/resources/`

#### Scenario: a lower-case Data folder
- GIVEN a path `pharaoh/data/pharaoh_general.sg3`
- WHEN `findGameRoot` runs
- THEN it returns `pharaoh/`

#### Scenario: no Pharaoh folder
- GIVEN paths with no `Data/Pharaoh_General.sg3` at any depth (`x.txt`, `extras/manual.pdf`)
- WHEN `findGameRoot` runs
- THEN it returns `null`

### Requirement: Only the files under the root are read and mounted
The page SHALL read and mount only the files under the game root, SHALL strip the root prefix from each path, and SHALL mount each file at `/PharaohData/<path relative to the root>` — the path `start_game` checks for. Files outside the root SHALL be skipped without being read. The status line SHALL say how many files are being read, counting only those under the root.

#### Scenario: the GOG folder is picked
- GIVEN the player picks `pharaoh-plus-cleopatra/`, holding 1345 files with the game in `Akhenaten/resources/`
- WHEN the page loads the folder
- THEN it mounts `/PharaohData/Data/Pharaoh_General.sg3` and `start_game` starts the game
- AND the status line names the number of files under `Akhenaten/resources/`

#### Scenario: files outside the root are skipped
- GIVEN the chosen folder also holds `extras/`, `akhenaten.linux` and a zip next to the game root
- WHEN the page loads the folder
- THEN nothing outside the game root is mounted, and the game starts as if only the root had been picked

#### Scenario: no game root
- GIVEN the player picks a folder that holds no `Data/Pharaoh_General.sg3`
- WHEN the page loads it
- THEN `#status` shows "This folder does not hold Pharaoh's Data folder." at once
- AND no file byte is read and `start_game` is not called

#### Scenario: a folder dropped and the same folder picked
- GIVEN the game files inside two extra folder levels
- WHEN the player either drags that folder onto the page or picks it in the dialog
- THEN both mount the same `/PharaohData/...` paths

### Requirement: The checks cover the root search
`web/tests/folder-test.mjs` SHALL unit-test `findGameRoot` for the cases above and SHALL be run by `scripts/check.sh`, and `scripts/web-smoke.sh` SHALL take `SMOKE_WRAP=<dir>/<dir>` to stage the game files that much deeper and load them through the page's own folder picker.

#### Scenario: the wrapped browser run
- GIVEN `SMOKE_WRAP=outer/inner` and a Pharaoh folder in `OSIRIS_DATA`
- WHEN `SMOKE_WRAP=outer/inner OSIRIS_DATA=<folder> SMOKE_MISSION=direct scripts/web-smoke.sh` runs
- THEN the page reads the files from `outer/inner/PharaohData/...` through the picker
- AND the run prints `osiris web: city started and ran 2 months: 1, 2`
