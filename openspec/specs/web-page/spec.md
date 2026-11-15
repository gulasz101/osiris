# web-page Specification

## Purpose
Serve the HTML page that loads the Osiris wasm module, provides a folder picker for the player's Pharaoh installation, and starts the game in the browser.

## Requirements

### Requirement: Page loads the game module
The repo SHALL build a page in `web/` that loads the Osiris wasm module in a browser and logs `osiris web: ready` without a panic.

#### Scenario: headless smoke test
- GIVEN `scripts/build-web.sh` has built `web/pkg/`
- WHEN `scripts/web-smoke.sh` opens the page in headless Chromium
- THEN the console shows `osiris web: ready`
- AND no console message contains `panicked`

### Requirement: Nothing leaves the computer
The page SHALL load no external URL and SHALL NOT send the player's files anywhere.

#### Scenario: no external requests
- GIVEN the page open in a browser
- WHEN it loads
- THEN every request goes to the page's own host

### Requirement: Start from the player's folder
The page SHALL let the player choose their Pharaoh folder, read its files into memory without uploading them, and open the game's main menu.

#### Scenario: real game folder
- GIVEN the page open in Chromium and a Pharaoh + Cleopatra folder from GOG
- WHEN the player chooses that folder
- THEN the console shows `osiris web: main menu`
- AND the canvas shows the main menu

#### Scenario: wrong folder
- GIVEN a folder without a `Data` folder inside
- WHEN the player chooses it
- THEN the page shows "This folder does not hold Pharaoh's Data folder." and the button again
