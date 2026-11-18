# web-cursor: design

All numbers are little-endian. The layout below was checked by the PM against the player's
`Pharaoh.exe` on this machine (`/Users/paperclip/PharaohData/Akhenaten/resources/Pharaoh.exe`).
Docs: Microsoft "PE Format" (resource section), "BITMAPINFOHEADER", "ICONDIR / GRPICONDIR"
(a cursor group uses the same layout as an icon group). winit 0.30.13: `CustomCursor::from_rgba`
(`src/cursor.rs:84`), `ActiveEventLoop::create_custom_cursor` (`src/event_loop.rs:390`),
`Window::set_cursor` (`src/window.rs:1425`, "Web: custom cursors have to be loaded and decoded
first, until then the previous cursor is shown"). Look them up in docs-mcp `winit` before coding.

## 1. `osiris_formats::pe::resource(exe, kind, id) -> Option<&[u8]>`
1. `e_lfanew = u32 at 0x3C`. At `e_lfanew` the 4 bytes are `PE\0\0`, else `None`.
2. COFF header at `pe = e_lfanew + 4`: `sections = u16 at pe+2`, `opt_size = u16 at pe+16`.
3. Optional header at `opt = pe + 20`: `magic = u16 at opt` (0x10B = PE32, 0x20B = PE32+).
   Data directories start at `opt + 96` (PE32) or `opt + 112` (PE32+). The resource directory
   is entry 2: `rsrc_rva = u32 at dirs + 16`.
4. Section table at `opt + opt_size`, 40 bytes each: `virtual_size = u32 at +8`,
   `virtual_address = u32 at +12`, `raw_size = u32 at +16`, `raw_pointer = u32 at +20`.
   `file_offset(rva)`: the section with `va <= rva < va + max(virtual_size, raw_size)` gives
   `rva - va + raw_pointer`.
5. `root = file_offset(rsrc_rva)`. A directory at `root + o`: `named = u16 at +12`,
   `ids = u16 at +14`, then `named + ids` entries of 8 bytes: `name_or_id = u32`, `target = u32`.
   `target & 0x8000_0000` set: a sub-directory at `root + (target & 0x7FFF_FFFF)`; clear: a data
   entry at `root + target` with `data_rva = u32 at +0`, `size = u32 at +4`.
6. Walk: root directory -> entry whose id is `kind` -> its directory -> entry whose id is `id`
   -> its directory (languages) -> the first entry -> data entry ->
   `&exe[file_offset(data_rva)..][..size]`.
Every read is bounds-checked; any out-of-range offset gives `None`, never a panic.

Resource kinds used: `RT_CURSOR = 1`, `RT_GROUP_CURSOR = 12`.

## 2. `osiris_formats::cursor`
```rust
pub struct CursorImage { pub width: u16, pub height: u16, pub hot_x: u16, pub hot_y: u16, pub rgba: Vec<u8> }
pub fn decode(res: &[u8]) -> Option<CursorImage>             // one RT_CURSOR resource
pub fn from_exe(exe: &[u8], group: u16) -> Option<CursorImage> // a RT_GROUP_CURSOR id
```
`decode`: `hot_x = u16 at 0`, `hot_y = u16 at 2`, then a BITMAPINFOHEADER at `b = 4`:
`header_size = u32 at b`, `width = i32 at b+4`, `height2 = i32 at b+8` (twice the real height:
picture plus mask), `bits = u16 at b+14`, `colours_used = u32 at b+32`.
`height = height2 / 2`. Only `bits` 1, 4 or 8 are supported (else `None`).
Palette at `b + header_size`: `n = colours_used`, or `1 << bits` when it is 0; each entry is
4 bytes B, G, R, 0. Colour bits follow the palette, rows bottom-up, row stride
`((width * bits + 31) / 32) * 4`. The AND mask follows the colour bits, 1 bit per pixel, rows
bottom-up, stride `((width + 31) / 32) * 4`. Bits inside a byte go from the high bit to the low.
Pixel (x, y), y counted from the top: `row = height - 1 - y`; mask bit 1 -> `[0, 0, 0, 0]`;
mask bit 0 -> the palette colour `[R, G, B, 255]`.

`from_exe`: `g = pe::resource(exe, 12, group)?`; `count = u16 at 4`; take the first entry at
6 (14 bytes); its cursor id is `u16 at 6 + 12`; `decode(pe::resource(exe, 1, id)?)`.

Measured on the player's exe (the check for task 1.4):

| group | kind | size | hotspot | opaque | white | black |
|---|---|---|---|---|---|---|
| 102 | arrow | 32x32 | 0,0 | 135 | 81 | 54 |
| 130 | shovel | 32x32 | 8,31 | 301 | 142 | 159 |
| 136 | sword | 32x32 | 0,0 | 168 | 82 | 86 |

## 3. `osiris_app::cursor`
```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CursorKind { Arrow, Shovel, Sword }
pub fn kind_for(tool: Tool, commanding: bool) -> CursorKind
pub struct Cursors { arrow: CustomCursor, shovel: CustomCursor, sword: CustomCursor }
impl Cursors {
    pub fn load(event_loop: &ActiveEventLoop, data: &Path) -> Option<Cursors>
    pub fn get(&self, kind: CursorKind) -> &CustomCursor
}
```
`kind_for`: `commanding` -> `Sword`; else `Tool::Clear` -> `Shovel`; else `Arrow`.
`commanding` is `game.selected_company.is_some() || game.selected_ship.is_some()`.
`load` reads `Pharaoh.exe` from the data folder through the same file layer the game uses for its
other files (`osiris_vfs`; find how `main.rs` or `assets` opens `Pharaoh_Text.eng` and do the
same, because the store is case-insensitive in the browser and the name is `PHARAOH.EXE` in some
installs). Then `CustomCursor::from_rgba(img.rgba, img.width, img.height, img.hot_x, img.hot_y)`
and `event_loop.create_custom_cursor(source)` for groups 102, 130, 136.
On any failure: `log::warn!` (or the logger the file already uses) one line
`osiris: no game cursors (<reason>), system cursor` and return `None`.

## 4. In `main.rs`
- `App` gets `cursors: Option<cursor::Cursors>` and `cursor_kind: Option<CursorKind>`.
- Load in `resumed`, right after each `event_loop.create_window(..)` succeeds (two places:
  about lines 1346 and 1403), and set the arrow at once.
- In `WindowEvent::RedrawRequested` (about line 1755): `kind` is `kind_for(game.tool,
  commanding)` on `Screen::Playing`, else `Arrow`. When `Some(kind) != self.cursor_kind`, call
  `window.set_cursor(cursors.get(kind).clone())` and store it. Calling it only on a change keeps
  it out of the hot path; calling it from the redraw and not from inside the mouse handler keeps
  clear of the winit web "RefCell already borrowed" panic noted at `main.rs:713`.
- Browser only: put `"cursor":"arrow|shovel|sword"` into the `debug_city()` JSON
  (`soak::city_json`, called at about line 1942) so the smoke test can read it.
