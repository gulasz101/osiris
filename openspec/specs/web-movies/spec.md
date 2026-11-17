# web-movies Specification

## Purpose
TBD - created by archiving change web-movies. Update Purpose after archive.

## Requirements

### Requirement: Movies play in the browser
The browser build SHALL play the original's Bink movies (`BINKS/High/*.bik`) full window, with sound when an audio device is open, and SHALL skip a movie on a click or a skip key, as the desktop build does.

#### Scenario: the intro plays
- GIVEN the page open with no query, movies on, and a Pharaoh folder chosen
- WHEN the game starts
- THEN the log shows `osiris web: movie Intro_big started` and then `osiris web: movie Intro_big frame 30` and `frame 60`, with no panic, and the screen is not all black

#### Scenario: the player skips the intro
- GIVEN the intro playing in the browser
- WHEN the player presses Escape
- THEN the log shows `osiris web: movie Intro_big done` and then `osiris web: page main`

#### Scenario: no movie files
- GIVEN a Pharaoh folder without `BINKS/High/Intro_big.bik`
- WHEN the game starts
- THEN the main menu shows, with no panic and no `movie` error in the console

#### Scenario: desktop unchanged
- GIVEN the desktop build
- WHEN a movie plays
- THEN it decodes on its own thread as before and `cargo test -p osiris-app` passes
