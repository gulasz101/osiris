# Delta for web-perf

## ADDED Requirements

### Requirement: The soak run shows where the frame time goes
In the soak run, the page SHALL log, next to each fps line, the average and worst time per
frame of the game rules (sim), the drawing (render), the game file reads (io) and the rest
(other), and at the end of the run the files whose reads took the most time. A player's
console SHALL stay quiet: nothing is timed unless the soak run turned it on.

#### Scenario: the frame split in the soak run
- GIVEN the game files are staged
- WHEN the soak run plays mission 0 at the fastest speed
- THEN the console holds `osiris web: frame ms sim <x> render <y> io <z> other <w> (worst ...)`
- AND before `soak OK` it holds `osiris web: top reads <path> <n>x <ms> ms; ...`

### Requirement: The biggest cost of ours is lower
After this change, the soak run's min fps SHALL be at least twice the 6 fps that `web-lazy`
logged, or its frame line SHALL show that the sim and io parts went down and most of the frame
is render and other. The game rules SHALL NOT change, and the soak run's `memory start` SHALL
stay below 300 MB.

#### Scenario: a long game after the fix
- GIVEN the game files are staged
- WHEN the soak run plays mission 0 for 24 months
- THEN its `soak OK` line shows `min fps` of at least 12, or the frame line shows the split above
- AND `memory start` is below 300 MB
