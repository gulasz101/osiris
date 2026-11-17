# Delta for web-saves-io

## ADDED Requirements

### Requirement: The page lists every save under /user
The page SHALL offer a `Saves` control that opens a panel listing every saved game under
`/user`: the `.osiris` files in `/user/saves` and in `/user/families/<folder>/saves`. Each row
SHALL name the family (the name in that folder's `name.txt`, or the folder's own name when there
is none), the file name, the size in bytes as a readable amount, the time it was written when
that is known, and a Download button.

#### Scenario: a save written while playing
- GIVEN the player made the `Smoke` family and saved Nubt in the browser
- WHEN the player opens the Saves panel
- THEN the list has a row for `Nubt`, family `Smoke`, with the file's size and write time

#### Scenario: nothing saved yet
- GIVEN no save under `/user`
- WHEN the player opens the Saves panel
- THEN the panel says there is nothing to show and offers the import

### Requirement: A save downloads as the desktop's own file
The Download button SHALL read the file's bytes from the page's store, make a `Blob` of them,
and offer it as a file named after the save with an `<a download>` link. The downloaded file
SHALL be byte for byte the file the game wrote, so the desktop Osiris can load it.

#### Scenario: download then open on the desktop
- GIVEN a saved game in the browser
- WHEN the player downloads it
- THEN the browser keeps a file named `<name>.osiris`
- AND its bytes are the same as the bytes in IndexedDB
- AND the desktop Osiris loads that file

### Requirement: A save imports into the active family's folder
The panel SHALL offer an `Import save` file input. A chosen file SHALL be written into the
active family's saves folder through the same `/user` write path the game uses, so it is kept in
IndexedDB. A file over 20 MB SHALL be refused, and so SHALL a name holding `/` or `..`; a
refused import SHALL say why in the panel and SHALL change nothing.

#### Scenario: a file from another computer
- GIVEN a save file on the player's disk
- WHEN the player imports it while the `Smoke` family is active
- THEN it appears in `/user/families/smoke/saves`, in the list, and in the game's load screen

#### Scenario: a file that is too big
- GIVEN a 40 MB file
- WHEN the player chooses it in `Import save`
- THEN the panel says the file is over 20 MB
- AND nothing is written to `/user`

#### Scenario: a name with a path in it
- GIVEN a file named `../settings.osiris`
- WHEN the player chooses it in `Import save`
- THEN the import is refused and nothing outside the saves folder is written

### Requirement: The panel only touches user saves
Every path the page can ask the browser build to read, write or delete SHALL be under `/user/`,
and a read or delete SHALL be refused unless it is an `.osiris` file directly inside a saves
folder the list covers.

#### Scenario: a path outside the saves
- GIVEN the page asks the browser build to read `/user/rules.toml`
- WHEN the browser build handles the request
- THEN it refuses and returns no bytes

### Requirement: A save moves between the browser and the desktop unchanged
The save format SHALL stay the desktop Osiris's format, and the same read and write functions
SHALL move a save's bytes with no change. A unit test SHALL write made-up save bytes through the
desktop file layer, pass them through the web read and write functions, and compare the result
byte for byte.

#### Scenario: bytes survive the round trip
- GIVEN bytes written by the desktop save path
- WHEN they go through the web read and the web write
- THEN the written file is byte for byte the original

### Requirement: The smoke run proves export and import
The smoke test SHALL accept `SMOKE_SAVES=1` with `OSIRIS_DATA` set: start mission 0 from the
menu, run a month, save with the save hotkey, open the Saves panel, download the save, compare
its size with the same file in IndexedDB, delete it, import it again with the file input, and
load it from the game's Load Saved Game screen. The run SHALL print
`osiris web: saves export/import OK`. Every existing mode SHALL keep passing.

#### Scenario: the whole round trip
- GIVEN a machine with the Pharaoh files in `OSIRIS_DATA`
- WHEN `SMOKE_SAVES=1 scripts/web-smoke.sh` runs
- THEN the save is downloaded, deleted and imported again
- AND the game loads the city from that save
- AND the run prints `osiris web: saves export/import OK`
