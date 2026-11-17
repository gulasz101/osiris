# Delta for web-lazy

## ADDED Requirements

### Requirement: Game files are read when the game opens them
In the browser, the page SHALL NOT copy the game files into wasm memory before the game starts.
It SHALL keep each picked or restored file as a browser `File`, tell the file store its path and
size, and copy its bytes into wasm memory only when the game reads it. The store SHALL NOT keep
those bytes after the read.

#### Scenario: starting from the picker
- GIVEN the player picks a Pharaoh folder
- WHEN the page starts the game
- THEN the console holds `osiris web: indexed <n> files (<x> MB) in <m> ms`
- AND the main menu opens with `osiris web: main menu`

#### Scenario: a long game stays small
- GIVEN the game files are staged
- WHEN the soak run plays mission 0 for 24 months
- THEN its line `osiris web: soak OK (...)` shows `memory start` below 300 MB

### Requirement: The page reads a file synchronously
`web/files.js` SHALL read a registered `File` synchronously on the main thread and return its
exact bytes, and SHALL throw an error naming the path when the file is not registered or the
read fails.

#### Scenario: a 40 MB file read back
- GIVEN a 40 MB `File` of random bytes registered under a path
- WHEN the page reads that path
- THEN every byte matches and the test prints `osiris web: sync read OK (40 MB in <n> ms)`
