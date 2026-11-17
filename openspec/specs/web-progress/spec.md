# web-progress Specification

## Purpose
Reading a full Pharaoh install means a few hundred megabytes and over a thousand files, and the
page used to sit on its start screen for several seconds with nothing to show for it. This
capability puts a bar over the picture that counts the files as they are read — from the folder
picker, from a drag and drop, or from the copy the page keeps in browser storage — and reads
several files at a time instead of one, so the start is both shorter and honest about what it is
doing. It also logs how long the start took, so a slower machine is a number rather than a
feeling.

## Requirements

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

### Requirement: A progress bar while the game files are copied to browser storage
A folder pick, a drop and a restore from browser storage SHALL NOT read the game files, and SHALL
NOT show a progress bar. While the page copies the files into browser storage after the game has
started, it SHALL show a bar over the canvas with the text
`Reading game files: <done> / <total> (<percent>%)`, repaint it at most every 100 ms, show the
final count when the copy ends, and hide it afterwards.

#### Scenario: picking a folder
- GIVEN a Pharaoh folder of 1335 files
- WHEN the player picks it
- THEN the page logs `osiris web: indexed 1335 files (<x> MB) in <m> ms`
- AND no progress bar is shown, because nothing was read

#### Scenario: copying the files into browser storage
- GIVEN the game is running and the page is copying the picked files into browser storage
- WHEN part of the copy is done
- THEN the page shows `Reading game files: 412 / 1335 (31%)`, with the percent rounded
- AND the bar is hidden once the copy finishes

#### Scenario: a copy that fails
- GIVEN the page is copying the game files into browser storage
- WHEN one of the files cannot be read
- THEN the bar goes away
- AND the page logs what went wrong and drops the incomplete copy
