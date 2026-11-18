# web-right-click: one right-click puts the tool down

## Why
Wojtek, 2026-11-18 (GUL-1864), playing the browser build: "the right click should disarm the
current tool and now it is just right click on the map". In the original Pharaoh a right-click
with a building in hand drops the building, so you never place one by accident.

Osiris already has this path: `WindowEvent::MouseInput` (`crates/osiris-app/src/main.rs:1689`)
calls `Game::cancel()` (`crates/osiris-app/src/game.rs:1359`), and its last step sets
`self.tool = Tool::None`. But `cancel()` closes one thing per click, in order: review, advisors,
info, dialogs and panels, the selected company or ship, the open sidebar menu, and only then the
tool. So with a sidebar menu open, the first right-click only closes the menu and the tool stays
in hand. Nothing checks this today, on the desktop or in the browser.

## What changes
- `Game::cancel()`: when a tool is in hand and no window, dialog or panel is open, one
  right-click drops the tool and closes the open sidebar menu in the same click. A right-click
  during a left-drag placement still cancels only the drag (the original game does the same:
  the first right-click cancels the half-placed row, the second drops the building).
- Unit tests in `crates/osiris-app/src/game.rs` and `crates/osiris-app/src/ui_steps.rs`.
- A browser smoke flow `SMOKE_RIGHTCLICK=1`: pick a tool from the sidebar, right-click the map
  once, and read `debug_city()`'s `"tool"`: it must be `"none"`. It also checks that the
  browser's own context menu did not open.
- `docs/STATUS.md` says so.

## What does not change
- Game rules (`osiris-sim`). A right-click with no tool in hand still inspects the tile.
- Right-click on modal windows (dialogs, advisors, info panels) still closes them first.
