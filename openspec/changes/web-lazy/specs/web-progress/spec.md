# Delta for web-progress

## ADDED Requirements

### Requirement: A progress bar while the game files are copied to browser storage
A folder pick, a drop and a restore from browser storage SHALL NOT read the game files, and SHALL
NOT show a progress bar. While the page copies the files into browser storage after the game has
started, it SHALL show a bar over the canvas with the text
`Reading game files: <done> / <total> (<percent>%)`, repaint it at most every 100 ms, show the
final count when the copy ends, and hide it afterwards.

#### Scenario: picking a folder
- GIVEN a Pharaoh folder of 1335 files
- WHEN the player picks it
- THEN the page logs `osiris web: indexed 1335 files (<x> MB) in <m> ms`
- AND no progress bar is shown, because nothing was read

#### Scenario: copying the files into browser storage
- GIVEN the game is running and the page is copying the picked files into browser storage
- WHEN part of the copy is done
- THEN the page shows `Reading game files: 412 / 1335 (31%)`, with the percent rounded
- AND the bar is hidden once the copy finishes

#### Scenario: a copy that fails
- GIVEN the page is copying the game files into browser storage
- WHEN one of the files cannot be read
- THEN the bar goes away
- AND the page logs what went wrong and drops the incomplete copy

## REMOVED Requirements

### Requirement: A progress bar while the game files are read
**Reason**: a pick, a drop and a restore no longer read the game files (`web-lazy`), so the bar
has nothing to count there. The copy into browser storage keeps the bar, in the requirement added
above.

### Requirement: The files are read with up to eight reads at a time
**Reason**: the picker and the restore no longer read the files (`web-lazy`), so there is nothing
left to read a few at a time. `web/progress.js` keeps `readAll` for the tests that still cover it,
but nothing on the start path uses it.
