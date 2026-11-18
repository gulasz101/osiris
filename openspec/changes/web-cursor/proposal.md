# web-cursor: the game's own mouse cursors

## Why
Wojtek, 2026-11-18 (GUL-1864): in the browser the mouse pointer never changes. In the original
game the cursor shows what you are doing: a shovel when you clear land, a sword when you command
soldiers or a warship.

Osiris has no game cursor at all, on the desktop or in the browser: nothing calls winit's
`Window::set_cursor`, so both builds show the system arrow. The only cursor call hides it during
a movie (`crates/osiris-app/src/main.rs:713-742`, desktop only).

The cursor pictures are not in the `.sg3`/`.555` files. They are Windows cursor resources inside
the player's own `Pharaoh.exe` (21 of them, all 32x32, black and white). The player's folder
already holds `Pharaoh.exe`, and the page mounts every file under the game root, so the game can
read it like any other game file. Nothing from the exe goes into git.

Which cursor when, from the reimplementation Akhenaten (`src/input/cursor.cpp`,
`input_cursor_update`), checked against the pictures in the exe:
- the shovel (group 130) while the clear-land tool is in hand;
- the sword (group 136) while a company of soldiers or a warship is selected and takes orders;
- the arrow (group 102) everywhere else, building tools included (the building's ghost on the
  map already shows what you build).

## What changes
- `crates/osiris-formats/src/pe.rs` (new): read one resource out of a Windows `.exe`.
- `crates/osiris-formats/src/cursor.rs` (new): turn a cursor group from the exe into RGBA pixels
  and a hotspot.
- `crates/osiris-app/src/cursor.rs` (new): `CursorKind { Arrow, Shovel, Sword }`, the rule above,
  and loading the three cursors with winit's `CustomCursor::from_rgba`.
- `main.rs`: load the cursors once the window exists; set the cursor when the kind changes.
- With no `Pharaoh.exe`, or a cursor that does not decode, the game keeps the system arrow and
  logs one line. It never fails to start because of a cursor.
- Smoke flow `SMOKE_CURSOR=1`, `docs/STATUS.md`.

## What does not change
- Game rules. The desktop gets the same cursors (same code, no cfg gate needed).
- The other 18 cursors in the exe (ships, chariots, formations, help) are not used yet.
- No cursor scaling: the cursor stays 32x32 at interface scale 1.5 and 2.
