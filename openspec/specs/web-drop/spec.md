# web-drop Specification

## Purpose
Let the player start the game by dragging the Pharaoh folder from the file manager onto the page, instead of finding it in a file dialog. The dropped folder is read in the browser and mounted under the same paths as the folder button, so the game sees no difference.

## Requirements

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
