# Delta for web-gpu-fps

## ADDED Requirements

### Requirement: The page says which graphics adapter it draws with
At start, the web page SHALL log `osiris web: gfx backend <WebGPU|WebGL2> adapter <name>` from
the wgpu adapter it got, once, in every run.

#### Scenario: the adapter line in a smoke run
- GIVEN the game files are staged
- WHEN `scripts/web-smoke.sh` opens the page
- THEN the console holds one `osiris web: gfx backend ... adapter ...` line

### Requirement: The soak runs on the real GPU on request
With `SMOKE_GPU=1`, the smoke run SHALL launch Chromium on the host's GPU and SHALL fail when the
page got a software adapter. Without it, the soak SHALL run as before.

#### Scenario: a GPU soak on the M1 Air
- GIVEN the game files are staged on the M1 Air
- WHEN `OSIRIS_DATA=<folder> SMOKE_SOAK=1 SMOKE_GPU=1 scripts/web-smoke.sh` runs
- THEN the adapter line names an Apple GPU, not SwiftShader or llvmpipe
- AND the run prints `soak OK (... min fps ...)` and the `frame ms sim ...` line
