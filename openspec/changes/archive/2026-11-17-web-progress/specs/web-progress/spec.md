# Delta for web-progress

## ADDED Requirements

### Requirement: A progress bar while the game files are read
While the page reads the player's game files, after a folder pick, after a drop, or while it
restores the copy in browser storage, it SHALL show a bar over the canvas with the text
`Reading game files: <done> / <total> (<percent>%)`, where the percent is
`done / total` rounded to the nearest whole number. The page SHALL repaint the bar at most
every 100 ms, SHALL show the final count when the read ends, and SHALL hide the bar afterwards.

#### Scenario: reading a full install
- GIVEN a Pharaoh folder of 1335 files
- WHEN the player picks it
- THEN the page shows `Reading game files: 412 / 1335 (31%)` partway through the read
- AND the bar repaints no more often than every 100 ms

#### Scenario: a copy restored from browser storage
- GIVEN a complete copy of the game files in the browser's storage
- WHEN the player opens the page
- THEN the same bar shows the same text while the copy is read

#### Scenario: a file cannot be read
- GIVEN the folder was moved while the page was reading it
- WHEN one read fails
- THEN the bar goes away and the status line says what went wrong
- AND the game is not started from a half-read folder

### Requirement: The files are read with up to eight reads at a time
The page SHALL read the game files with at most eight reads in flight at the same time, instead
of one file at a time, and SHALL mount every file. When a read fails, the page SHALL stop the
other reads rather than mount files after the failure.

#### Scenario: a full install
- GIVEN 1335 game files
- WHEN the page reads them
- THEN never more than eight reads are in flight
- AND all 1335 files are mounted

### Requirement: The browser build logs how long the start took
The browser build SHALL log `osiris web: menu after <N> ms` at the main menu, where `N` is the
time since the page started, or since the player picked their folder when they picked one. A
run that starts a mission from the address never builds the menu and SHALL NOT log the line.

#### Scenario: pick to main menu
- GIVEN the page showing its folder field
- WHEN the player picks a Pharaoh folder and the main menu comes up
- THEN the console shows `osiris web: main menu`
- AND the console shows `osiris web: menu after N ms`

### Requirement: The page is built from a release wasm, with wasm-opt when it is installed
`scripts/build-web.sh` SHALL build the wasm in release mode. When `wasm-opt` is on `PATH` it
SHALL run `wasm-opt -O2` on `web/pkg/osiris_bg.wasm`; when it is not, it SHALL print one line
saying so and publish the plain release build. `wasm-opt` SHALL NOT become a requirement for
building the page.

#### Scenario: wasm-opt is not installed
- GIVEN a machine without binaryen
- WHEN `scripts/build-web.sh` runs
- THEN one line says there is no `wasm-opt` and the plain release build is published
- AND the page still builds and runs

### Requirement: The smoke run proves the bar and the start time
The smoke test SHALL accept `SMOKE_PICK=1` with `OSIRIS_DATA` set: give the staged folder to
the page's own folder picker, wait for the bar while the files are read, save the bar as
`/tmp/osiris-web-loading.png`, and then check the main menu as the ordinary run does. Every
smoke run that reaches the main menu SHALL check `osiris web: menu after N ms`. All existing
modes SHALL keep passing.

#### Scenario: the loading screenshot
- GIVEN a machine with the Pharaoh files in `OSIRIS_DATA`
- WHEN `SMOKE_PICK=1 scripts/web-smoke.sh` runs
- THEN the page shows the bar while it reads the files
- AND `/tmp/osiris-web-loading.png` shows the bar
- AND the run prints `osiris web: loading bar OK` and `osiris web: menu after N ms`
