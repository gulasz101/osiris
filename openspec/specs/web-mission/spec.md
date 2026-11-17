# web-mission Specification

## Purpose
Start a campaign mission in the browser, either from `?mission=N` in the page URL or from the main menu, and run its city with the simulation advancing.

## Requirements

### Requirement: A mission starts in the browser
The browser build SHALL start a campaign mission, either directly from `?mission=N` in the page URL or from the main menu, and run its city with the simulation advancing.

#### Scenario: direct start
- GIVEN the page open with `?mission=3` and a Pharaoh folder chosen
- WHEN the game starts
- THEN the log shows `osiris web: city 3 started` and then two different `osiris web: city month` lines, with no panic

#### Scenario: start from the menu
- GIVEN the page open with no query and a Pharaoh folder chosen
- WHEN the player creates a family, opens the campaign and goes from the first mission's briefing to the city
- THEN the log shows `osiris web: page briefing`, `osiris web: city <m> started` and two different month lines, with no panic

#### Scenario: bad mission number
- GIVEN the page open with `?mission=abc`
- WHEN the player chooses a folder
- THEN `#status` shows "mission must be a number" and the game does not start

### Requirement: Menu buttons are readable by tests
The browser build SHALL export `debug_menu_buttons()`, returning the current menu page's buttons with their action, label and rectangle in CSS pixels.

#### Scenario: registry page
- GIVEN the menu on the family registry page
- WHEN a test calls `debug_menu_buttons()`
- THEN it gets a non-empty JSON list, and clicking the centre of an entry runs that entry's action
