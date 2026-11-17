# web-remember Specification

## Purpose

Let a player load their Pharaoh install once. The page keeps a copy of the game files in the
browser's own storage, so a later visit starts the game from that copy instead of asking for the
folder again. The copy is the browser's, never ours: it stays on the player's computer and the
player can delete it with one button.

## Requirements

### Requirement: The game files are copied into browser storage
After the page found the game root and started the game from the player's folder, it SHALL copy the
files under the root into the origin private file system, under a folder `game/`, keeping each
file's path relative to the root. It SHALL call `navigator.storage.persist()` once before the first
write, and SHALL copy file by file without delaying the start of the game.

#### Scenario: the copy follows the start
- GIVEN the player picked a folder whose root holds `Data/Pharaoh_General.sg3` and `AUDIO/Wavs/a.wav`
- WHEN the game has started from that folder and the copy has finished
- THEN `game/Data/Pharaoh_General.sg3` and `game/AUDIO/Wavs/a.wav` are in the origin private file system
- AND the console shows `osiris web: game files copied to browser storage (N files)`

#### Scenario: the copy starts only after the game does
- GIVEN the player picks the game folder
- WHEN the files are mounted and `start_game` has been called
- THEN the copy runs without `await` in the same task, so the game is not held back by it

### Requirement: The marker is written last
The page SHALL write the marker file `game/.complete` only after every file of the copy has been
written, and SHALL remove an older marker before the first write of a new copy.

#### Scenario: a copy that did not finish is not complete
- GIVEN the copy stopped after some files because the tab was closed
- WHEN the page is loaded again
- THEN `game/.complete` does not exist and the page asks for the folder as it does today

### Requirement: Files the game never reads are left out
Files whose name ends in `.pdf`, `.zip`, `.dll`, `.asi`, `.m3d` or `.tsk`, compared in lower case,
SHALL NOT be copied, and SHALL not be counted in the marker's count.

#### Scenario: the manual and the patch next to the game
- GIVEN the game root also holds `extras/manual.pdf`, `patch.zip` and `editor.dll`
- WHEN the copy runs
- THEN none of those three files is stored

### Requirement: The next page load starts the game from the stored files
When `game/.complete` exists, the page SHALL mount every stored file at
`/PharaohData/<path relative to the game root>`, SHALL start the game without showing the folder
picker, and SHALL log `osiris web: game files restored from browser storage (N files)`.

#### Scenario: a reload reaches the game with no picker
- GIVEN a complete copy in the origin private file system
- WHEN the page is loaded again
- THEN the console shows `osiris web: game files restored from browser storage (N files)`
- AND the game reaches its main menu without the player choosing a folder

#### Scenario: no copy yet
- GIVEN an origin private file system with no `game/` folder
- WHEN the page is loaded
- THEN the page shows the folder picker as it does today

### Requirement: The player can forget the stored game files
The page SHALL offer a "Forget game files" control, shown once a complete copy exists, which
deletes `game/` from the origin private file system and reloads the page.

#### Scenario: forgetting brings the picker back
- GIVEN a complete copy and the control on the page
- WHEN the player clicks "Forget game files"
- THEN the page reloads and shows the folder picker, and no `game/` folder is left

### Requirement: Missing or too little browser storage keeps today's behaviour
When the browser has no origin private file system, or its estimated free storage is smaller than
the files to copy, or a write fails, the page SHALL log one warning and SHALL keep working as it
does today: the player picks the folder on every load. It SHALL NOT fail the start of the game.

#### Scenario: a browser without the origin private file system
- GIVEN a browser where `navigator.storage.getDirectory` is undefined
- WHEN the player picks the game folder
- THEN one warning is logged and the game starts exactly as before

#### Scenario: the quota is too small
- GIVEN `navigator.storage.estimate()` reports less free space than the game files need
- WHEN the copy would start
- THEN one warning is logged, nothing is stored, and the game still starts

#### Scenario: a bad copy does not block the game
- GIVEN `game/.complete` exists but `game/Data/Pharaoh_General.sg3` was never stored
- WHEN the page restores the files and `start_game` rejects the folder
- THEN the page logs a warning, deletes the stored copy and shows the folder picker
