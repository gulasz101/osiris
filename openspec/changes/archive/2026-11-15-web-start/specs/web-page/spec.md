# Delta for web-page

## ADDED Requirements

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
