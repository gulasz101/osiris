# web-title Specification

## Purpose
The web page opens on a title screen with a menu, so the player chooses when the game starts,
sees a loading screen while it starts, and manages saved games from a styled page instead of a
bare MVP form.

## Requirements

### Requirement: The page opens on a title screen with a menu
The page SHALL open on a title screen with original artwork and a menu. Before any game files
are known the menu SHALL offer "Choose your Pharaoh folder" and "Saved games". Once the page
knows the game files, from a pick or from browser storage, it SHALL also show "Enter the game"
and SHALL NOT start the game until the player presses it.

#### Scenario: a pick shows Enter instead of starting
- GIVEN the title screen with no game files
- WHEN the player picks a folder that holds Pharaoh's Data folder
- THEN the title screen says how many game files it found
- AND it shows "Enter the game"
- AND the game has not started

#### Scenario: Enter starts the game
- GIVEN the title screen showing "Enter the game"
- WHEN the player presses it
- THEN the game starts and reaches its main menu

### Requirement: A loading screen covers the start
From the press of Enter until the game has drawn its first screen, the page SHALL show a
loading screen (`#loading`). The game SHALL call `globalThis.osirisReady` when its first screen
is ready, and the page SHALL then take the loading screen down and show its controls.

#### Scenario: the loading screen goes once the game is up
- GIVEN the player pressed "Enter the game"
- WHEN the game logs `osiris web: main menu`
- THEN the page logs `osiris web: the game is ready, taking the loading screen down`
- AND `#loading` is hidden
