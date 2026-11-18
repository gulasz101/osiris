# web-right-click: tasks

Game data for tests on this machine: `OSIRIS_TEST_DATA=/Users/paperclip/PharaohData/Akhenaten/resources`
(tests that need it skip without it). For the smoke run: `OSIRIS_DATA=` the same folder.

## 1. One right-click drops the tool

- [x] 1.1 In `Game::cancel()` (`crates/osiris-app/src/game.rs`, about line 1359), move the tool
      step up so it runs right after the `selected_company` / `selected_ship` step and before the
      `self.sidebar.open` step. The new step:
      ```rust
      if self.tool != Tool::None {
          // A right-click during a left-drag placement cancels the drag only.
          if self.drag_start.take().is_none() {
              self.tool = Tool::None;
              self.sidebar.open = None;
          }
          return;
      }
      ```
      Keep the old sidebar step below it (it still closes a menu when no tool is held) and delete
      the old last step (`if self.drag_start.take().is_none() { self.tool = Tool::None; }`), which
      the new step replaces. If `Tool` has no `PartialEq`, use `!matches!(self.tool, Tool::None)`.
      Check: `cargo test -p osiris-app --quiet` passes.
- [ ] 1.2 Add a unit test in `crates/osiris-app/src/ui_steps.rs`, next to
      `a_warship_takes_each_order_from_its_window`, named
      `one_right_click_drops_the_tool_with_the_menu_open`. Use `play(...)` like the tests around
      it. Set `game.tool = Tool::Build(<any house type the sidebar offers>)` and
      `game.sidebar.open = Some(<the value the sidebar uses for its house menu>)` (read
      `sidebar.rs` for the type of `open`), run one `step(game, r, "back")` (the scripted
      right-click, `right_click` in `ui_steps.rs`), then assert `game.tool == Tool::None` and
      `game.sidebar.open.is_none()`.
      Check: `OSIRIS_TEST_DATA=/Users/paperclip/PharaohData/Akhenaten/resources cargo test -p osiris-app one_right_click --quiet`
      prints `1 passed` (not `0 passed`; 0 means the data folder was not found).
- [ ] 1.3 Add a second test in the same place, `a_right_click_during_a_drag_keeps_the_tool`:
      `game.tool = Tool::Road`, `game.drag_start = Some((10, 10))`, one `"back"` step, then
      assert `game.drag_start.is_none()` and `game.tool == Tool::Road`. `drag_start` is a private
      field (`game.rs:141`); change it to `pub(crate) drag_start` so the test can set it.
      Check: same command with filter `a_right_click_during` prints `1 passed`.

## 2. The browser smoke flow

- [ ] 2.1 In `web/tests/smoke.mjs`, add `SMOKE_RIGHTCLICK=1` (copy how `SMOKE_VIEWPORT` is read at
      the top of the file). It runs with `SMOKE_MISSION=menu` only, like `SMOKE_VIEWPORT`. In
      `scripts/web-smoke.sh`, pass it through the same way as the other `SMOKE_*` variables.
      Check: `node --check web/tests/smoke.mjs` and `bash -n scripts/web-smoke.sh` pass.
- [ ] 2.2 The flow, after the city has started (put it where the other city flows run): register
      `page.on("console")` is already there; add, before the city starts,
      `await page.evaluate(() => { window.__contextmenus = 0; document.addEventListener("contextmenu", e => { if (!e.defaultPrevented) window.__contextmenus += 1; }); })`.
      Then: click the sidebar's road button (find its rectangle in
      `crates/osiris-app/src/sidebar.rs` and click its centre on the canvas, the way `clickMenu`
      clicks menu buttons); poll `debug_city()` up to 3 s until `"tool"` is `"road"`; then
      `page.mouse.click(x, y, { button: "right" })` at the centre of the city view; poll up to 3 s
      until `"tool"` is `"none"`; then read `window.__contextmenus`, which must be 0.
      Print `osiris web: right click OK (road -> none, no context menu)`, or `FAIL: right click ...`
      with what `debug_city()` said, and exit 1.
      Check: `node --check web/tests/smoke.mjs` passes.
- [ ] 2.3 Run it: `OSIRIS_DATA=/Users/paperclip/PharaohData/Akhenaten/resources SMOKE_MISSION=menu SMOKE_RIGHTCLICK=1 timeout 600 scripts/web-smoke.sh`.
      Check: the output has `osiris web: right click OK`. If it fails with the 1.1 change in place,
      do not change the design: commit what you have, write the exact `FAIL` line and the
      `debug_city()` JSON in the issue comment, and set the issue `blocked`.

## 3. Docs and the gate

- [ ] 3.1 `docs/STATUS.md`, section "2. Works": add one bullet, **One right-click puts the tool
      down.**, saying a right-click with a tool in hand drops it and closes the sidebar menu in
      one click, a right-click during a drag cancels the drag only, and the smoke command from 2.3.
      Check: `git diff --stat` shows only `docs/STATUS.md`.
- [ ] 3.2 `scripts/check.sh` ends with `CHECK OK`, then
      `scripts/openspec archive web-right-click -y`, commit and push.
