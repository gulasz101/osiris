# Delta for web-soak

## ADDED Requirements

### Requirement: A soak run plays a mission for 24 game months
With `SMOKE_SOAK=1` and game data, the smoke test SHALL start mission 0 from the main menu, set
the game speed to its fastest value, and let the city run until 24 game months have passed. It
SHALL log the frames per second every ten seconds of real time and the wasm memory's byte length
at every month, and it SHALL print one line naming the months run, the lowest frame rate seen and
the memory at its start and end.

#### Scenario: a mission played for two years
- GIVEN the game files are staged and the page has mounted them
- WHEN the test starts the first mission from the menu and the city runs 24 months
- THEN the console holds `osiris web: fps <n>` lines and one `osiris web: soak month <n> memory <bytes>` line per month
- AND the test prints `osiris web: soak OK (24 months, min fps N, memory start A MB end B MB)`

### Requirement: A custom map plays from the menu's Custom Missions screen
With `SMOKE_SOAK=1`, the smoke test SHALL reach a map below the first fifteen rows of the Custom
Missions list, pick `Small Oasis.map`, start its city from that screen, and let it run 6 months,
and SHALL print the same numbers for it.

#### Scenario: a map from Maps/ played in the browser
- GIVEN the main menu after the mission run
- WHEN the test opens Custom Missions, scrolls to `Small Oasis` and starts its city
- THEN the city runs 6 months with no panic
- AND the test prints `osiris web: custom map soak OK (6 months on Small Oasis, min fps N, memory start A MB end B MB)`

### Requirement: The Mission Editor opens, paints and saves a map in the browser
With `SMOKE_SOAK=1`, the smoke test SHALL open the Mission Editor from the main menu, open
`Small Oasis.map`, pick a paint tool, paint tiles on the map, save the map under a new name in
`/user/maps`, and go back to the main menu, all through the editor's own buttons and menu bar.

#### Scenario: an edited map written to the browser's storage
- GIVEN the main menu
- WHEN the test opens the Mission Editor, opens `Small Oasis`, paints three tiles and saves it as `Soak Edit`
- THEN the editor reports the map dirty before the save and `Saved /user/maps/Soak Edit.map` after it
- AND the menu is back and prints `osiris web: page main`
- AND no panic was logged

### Requirement: The soak fails on a panic, a stuck month or a growing memory
The soak run SHALL fail when a panic appears in the console, when a month does not arrive within
60 seconds of the one before it, or when the wasm memory grew at each of twelve months in a row.

#### Scenario: a city that stops turning months
- GIVEN a city whose month does not change for 60 seconds
- WHEN the soak's watchdog looks at it
- THEN the run exits with a failure naming the last month it saw

#### Scenario: memory that only grows
- GIVEN twelve months in a row whose wasm memory is larger than the month before
- WHEN the soak counts the twelfth
- THEN the run exits with a failure naming the memory at its start and end

### Requirement: The measured numbers are written down
`design.md` SHALL hold the frames per second and the memory per month the passing run measured,
and `docs/STATUS.md` SHALL say whether custom maps and the Mission Editor work in the browser,
naming the exact bug when either does not.

#### Scenario: a player reads what was tested
- GIVEN the change is archived
- WHEN the reader opens `docs/STATUS.md`
- THEN the Mission Editor and custom maps are listed with the smoke command that proves them
- AND `design.md` holds the run's frame rate and memory numbers
