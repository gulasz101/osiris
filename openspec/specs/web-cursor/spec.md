# web-cursor Specification

## Purpose

Show the game's own arrow, shovel and sword cursors, read out of the player's `Pharaoh.exe`, so
the pointer tells the player what a click does, in the browser as on the desktop.

## Requirements

### Requirement: The game shows the original cursors from the player's Pharaoh.exe
The game SHALL read the arrow (cursor group 102), the shovel (group 130) and the sword (group 136)
from `Pharaoh.exe` in the player's game folder and show them as the mouse cursor. Nothing from
the exe SHALL be written into the repository. Without a readable `Pharaoh.exe` the game SHALL keep
the system cursor, log one line, and start normally.

#### Scenario: the player's folder holds Pharaoh.exe
- GIVEN a game folder with `Pharaoh.exe`
- WHEN the game window opens
- THEN the mouse cursor is the game's arrow

#### Scenario: the folder has no Pharaoh.exe
- GIVEN a game folder without `Pharaoh.exe`
- WHEN the game starts
- THEN it logs `osiris: no game cursors (...), system cursor`
- AND it runs with the system cursor

### Requirement: The cursor follows the tool in hand
In the city, the cursor SHALL be the sword while a company of soldiers or a warship is selected,
the shovel while the clear-land tool is in hand, and the arrow otherwise, including while a
building or road tool is in hand. Every other screen SHALL show the arrow.

#### Scenario: clearing land
- GIVEN the player is in the city with no tool
- WHEN the player picks Clear Land in the sidebar
- THEN the cursor becomes the shovel
- AND it becomes the arrow again after a right-click drops the tool

#### Scenario: commanding soldiers
- GIVEN a company of soldiers is selected
- WHEN the mouse is over the city
- THEN the cursor is the sword
