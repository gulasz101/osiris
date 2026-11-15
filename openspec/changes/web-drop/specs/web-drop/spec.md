# Delta for web-drop

## ADDED Requirements

### Requirement: Folder can be dropped on the page
The start screen SHALL accept the Pharaoh folder dragged from the file manager and SHALL load it the same way as the folder button.

#### Scenario: folder dropped
- GIVEN the start screen in Chromium
- WHEN the player drops the folder `Pharaoh` holding `Data/Pharaoh_General.sg3`
- THEN `/PharaohData/Data/Pharaoh_General.sg3` is mounted and the game starts

#### Scenario: large directory
- GIVEN a dropped folder with 150 files in one directory
- WHEN the page reads it
- THEN all 150 files are loaded

#### Scenario: wrong drop
- GIVEN the start screen
- WHEN the player drops a single file that is not a Pharaoh folder
- THEN the start screen shows "This folder does not hold Pharaoh's Data folder." and stays open
