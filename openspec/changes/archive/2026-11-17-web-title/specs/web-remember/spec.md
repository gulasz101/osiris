## MODIFIED Requirements

### Requirement: The next page load starts the game from the stored files
When `game/.complete` exists, the page SHALL mount every stored file at
`/PharaohData/<path relative to the game root>`, SHALL log
`osiris web: game files restored from browser storage (N files)`, and SHALL offer
"Enter the game" on its title screen, which starts the game without the folder picker.

#### Scenario: a reload reaches the game with no picker
- GIVEN a complete copy in the origin private file system
- WHEN the page is loaded again
- THEN the console shows `osiris web: game files restored from browser storage (N files)`
- AND the title screen shows "Enter the game"
- AND after the player presses it the game reaches its main menu without the player choosing a folder

#### Scenario: no copy yet
- GIVEN an origin private file system with no `game/` folder
- WHEN the page is loaded
- THEN the page shows the folder picker as it does today
