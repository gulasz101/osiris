# web-loading Specification

## Purpose
The web page shows what the start is doing at every moment: the engine download on the title
screen, then each named step of the game's start with a tick and its time, so the player never
waits in front of a frozen screen.

## Requirements

### Requirement: The title screen says what the page does before its menu is ready
While the engine downloads and while the game files kept in the browser are opened, the title
screen SHALL show a line and a bar (`#boot`) saying so, with the downloaded and total megabytes
when the total is known. The menu SHALL appear once the page is ready.

#### Scenario: a first visit downloads the engine
- GIVEN a browser that has not cached the engine
- WHEN the page opens
- THEN the title screen shows "Downloading the engine: X / Y MB" and a bar that fills
- AND the menu appears after the engine has started

### Requirement: The loading screen shows each step of the start
The game SHALL name each step of its start (`files`, `rules`, `graphics`, `menu`) through
`globalThis.osirisStage` and log `osiris web: stage <name> at N ms`. Before each slow step it
SHALL wait until the page has painted the step. The loading screen SHALL list the steps, tick
each finished one with the time it took, and move its bar towards the end of the current step.

#### Scenario: a start shows its steps in order
- GIVEN the player pressed "Enter the game"
- WHEN the game reaches its main menu
- THEN the console shows the four `osiris web: stage` lines in order
- AND the loading screen ticks every step and says "Ready in N s" before it fades

#### Scenario: graphics fail
- GIVEN a browser where the game cannot start its graphics
- WHEN the graphics fail after `start_game` has returned
- THEN the loading screen shows the message and a "Reload the page" button
