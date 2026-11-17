# Delta for web-frame-trace

## ADDED Requirements

### Requirement: A trace run records the running city
`web/tests/smoke.mjs` SHALL accept `SMOKE_TRACE=<file>`, walk the menu to the first mission the
way the soak run does, set the fastest game speed, and record a Chrome performance trace for 20
seconds of the running city, with the trace written to `<file>`. The run SHALL NOT write the
trace inside the repository, and a run without `SMOKE_TRACE` SHALL record nothing.

#### Scenario: the trace run
- GIVEN the game files are staged and Chrome has the host's GPU
- WHEN `SMOKE_TRACE=/tmp/osiris-trace.json SMOKE_GPU=1 scripts/web-smoke.sh` runs
- THEN the run exits 0, prints `osiris web: trace written to /tmp/osiris-trace.json ...`, and
  `/tmp/osiris-trace.json` holds a non-empty Chrome trace
- AND no trace file is added to git

### Requirement: The report names the biggest main-thread slices
`scripts/trace-top.mjs <trace.json>` SHALL print the ten biggest main-thread slices by total
time with each slice's name, total milliseconds and count, and the mean milliseconds between two
`requestAnimationFrame` callbacks. It SHALL use no npm dependency beyond node itself.

#### Scenario: reading a trace
- GIVEN a trace written by the trace run
- WHEN `node scripts/trace-top.mjs /tmp/osiris-trace.json` runs
- THEN it prints a table of ten slices sorted by total time, and a line with the mean rAF gap
- AND its numbers match the lines copied into `docs/STATUS.md`

### Requirement: STATUS.md names what fills the gap
`docs/STATUS.md` SHALL name the cause of the ~180 ms between frames with a slice name from the
trace, give the command that produced it, and either the before/after soak numbers of a fix or a
proposed fix when the cause is outside our code.

#### Scenario: the status report
- GIVEN the trace run and the report have run on this host
- WHEN a reader opens `docs/STATUS.md` at the GPU bullet
- THEN the top-10 table and the rAF gap are there with the command
- AND the cause is named from the trace, not guessed
