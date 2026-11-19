# web-cursor: tasks

Read `design.md` first: it has every offset and the numbers the checks use.
Game data on this machine: `/Users/paperclip/PharaohData/Akhenaten/resources` (it holds
`Pharaoh.exe`). Read it, never copy it or any byte of it into the repo, a test or a log.

## 1. Read cursors out of the exe (`crates/osiris-formats`)

- [x] 1.1 New file `crates/osiris-formats/src/pe.rs` with
      `pub fn resource(exe: &[u8], kind: u32, id: u32) -> Option<&[u8]>`, exactly as design
      section 1, and `pub mod pe;` in `lib.rs`. Use checked reads (`get(..)?`), no panics.
      Check: `cargo test -p osiris-formats --quiet` passes.
- [x] 1.2 Unit test in `pe.rs`: a test helper `fn tiny_pe(kind: u32, id: u32, data: &[u8]) -> Vec<u8>`
      builds a 0x400-byte PE32 by hand: `MZ`, `e_lfanew = 0x40`, `PE\0\0` at 0x40, 1 section,
      `opt_size = 0xE0`, magic 0x10B, resource directory entry (at 0xC8) `rva = 0x1000`;
      section header at 0x138 with `virtual_address = 0x1000`, `virtual_size = raw_size = 0x200`,
      `raw_pointer = 0x200`; at 0x200 three directories (type, id, language), each with one id
      entry, then one data entry pointing at `data` placed after them. Tests:
      `resource(&tiny_pe(1, 7, b"abc"), 1, 7) == Some(&b"abc"[..])`, a wrong id gives `None`,
      a wrong kind gives `None`, and a 10-byte buffer gives `None`.
      Check: `cargo test -p osiris-formats pe --quiet` shows 4 passed.
- [x] 1.3 New file `crates/osiris-formats/src/cursor.rs` with `CursorImage`, `decode` and
      `from_exe`, as design section 2, and `pub mod cursor;` in `lib.rs`. Unit tests with bytes
      made in the test: an 8x2 1-bit cursor (height field 4, palette black then white, colour
      rows `0xF0` and `0x0F` bottom-up, mask rows `0x00` and `0xFF` bottom-up, hotspot 3,1;
      every row is padded to 4 bytes, so a row is e.g. `[0xF0, 0, 0, 0]`):
      `width 8, height 2, hot (3,1)`; the top row is fully transparent (mask `0xFF` is the top
      row because rows are bottom-up); the bottom row is 4 white then 4 black pixels with alpha
      255. A 24-bit header gives `None`. A 5-byte buffer gives `None`.
      Check: `cargo test -p osiris-formats cursor --quiet` passes, 3 or more tests.
- [x] 1.4 Test against the real exe, in `cursor.rs`:
      `#[test] fn the_players_exe_has_the_three_cursors()`. It reads
      `std::env::var("OSIRIS_TEST_DATA")` + `/Pharaoh.exe` and returns early (passes) when the
      variable or the file is missing. For groups 102, 130, 136 it asserts size, hotspot and the
      opaque, white and black pixel counts in the table in design section 2.
      Check: `OSIRIS_TEST_DATA=/Users/paperclip/PharaohData/Akhenaten/resources cargo test -p osiris-formats the_players_exe --quiet -- --nocapture`
      shows `1 passed`. Print nothing from the exe except the counts.

## 2. Show them (`crates/osiris-app`)

- [x] 2.1 New file `crates/osiris-app/src/cursor.rs` with `CursorKind` and
      `pub fn kind_for(tool: Tool, commanding: bool) -> CursorKind` (design section 3), and
      `mod cursor;` in `main.rs`. Unit tests: `(Tool::None, false)` -> Arrow,
      `(Tool::Clear, false)` -> Shovel, `(Tool::Road, false)` -> Arrow, `(Tool::Build(1), false)`
      -> Arrow, `(Tool::Clear, true)` -> Sword, `(Tool::None, true)` -> Sword.
      Check: `cargo test -p osiris-app cursor --quiet` passes.
- [x] 2.2 In the same file, `Cursors` with `load` and `get` (design section 3). Look up
      `CustomCursor::from_rgba` and `create_custom_cursor` in docs-mcp `winit` first.
      Check: `cargo test -p osiris-app --quiet` and
      `cargo check --target wasm32-unknown-unknown -p osiris-app` both pass.
- [x] 2.3 `main.rs`: the two `App` fields, load after each `create_window` and set the arrow
      (design section 4).
      Check: both commands from 2.2 pass.
- [x] 2.4 `main.rs`: set the cursor in `RedrawRequested` when the kind changes (design section 4).
      Check: both commands from 2.2 pass.
- [x] 2.5 Browser only: add `"cursor"` to the `debug_city()` JSON (design section 4). Update the
      example JSON in the doc comment of `debug_city` in `web.rs`.
      Check: both commands from 2.2 pass.

## 3. Smoke and docs

- [ ] 3.1 In `web/tests/smoke.mjs`, add `SMOKE_CURSOR=1` (read it like `SMOKE_VIEWPORT`, runs with
      `SMOKE_MISSION=menu` only) and pass it through in `scripts/web-smoke.sh`. The flow, after
      the city has started: poll up to 3 s until `debug_city()` has `"cursor":"arrow"` and
      `getComputedStyle(canvas).cursor` starts with `url(`; click the sidebar's Clear Land button
      (its rectangle is in `crates/osiris-app/src/sidebar.rs`; click its centre the way
      `clickMenu` clicks menu buttons); poll up to 3 s until `"cursor":"shovel"` and the canvas
      cursor starts with `url(` and differs from the arrow's; right-click the city view; poll
      until `"cursor":"arrow"`. Print `osiris web: cursor OK (arrow -> shovel -> arrow)` or
      `FAIL: cursor ...` with what it read, and exit 1.
      Check: `node --check web/tests/smoke.mjs` and `bash -n scripts/web-smoke.sh` pass.
- [ ] 3.2 Run it: `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources SMOKE_MISSION=menu SMOKE_CURSOR=1 timeout 600 scripts/web-smoke.sh`.
      Check: the output has `osiris web: cursor OK`. If it fails, do not change the design:
      commit what works, put the exact `FAIL` line in the issue comment and set it `blocked`.
- [ ] 3.3 `docs/STATUS.md`, section "2. Works": one bullet, **The game's own cursors.**: the
      arrow, the shovel for Clear Land and the sword for commanding, read from the player's
      `Pharaoh.exe`; no exe, system cursor; the smoke command from 3.2. Under "3. Missing or
      different from desktop" nothing changes (the desktop gets the same cursors).
      Check: `git diff --stat` shows only `docs/STATUS.md`.
- [ ] 3.4 `scripts/check.sh` ends with `CHECK OK`, then `scripts/openspec archive web-cursor -y`,
      commit and push.
