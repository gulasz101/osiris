//! The game's own mouse cursor: which picture to show, and the pictures themselves.

use std::path::Path;

use winit::event_loop::ActiveEventLoop;
use winit::window::CustomCursor;

use crate::game::Tool;

/// One of the three cursor pictures the game uses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CursorKind {
    Arrow,
    Shovel,
    Sword,
}

impl CursorKind {
    /// The name the browser's debug JSON and the smoke test use.
    pub fn name(self) -> &'static str {
        match self {
            CursorKind::Arrow => "arrow",
            CursorKind::Shovel => "shovel",
            CursorKind::Sword => "sword",
        }
    }
}

/// The cursor for the current state: the sword while a company of soldiers or a warship is
/// selected and takes orders, the shovel while the clear-land tool is in hand, and the arrow
/// everywhere else. Building tools keep the arrow: the ghost on the map already shows what is
/// being built.
pub fn kind_for(tool: Tool, commanding: bool) -> CursorKind {
    if commanding {
        CursorKind::Sword
    } else if tool == Tool::Clear {
        CursorKind::Shovel
    } else {
        CursorKind::Arrow
    }
}

/// The three cursor pictures from the player's `Pharaoh.exe`, built once the window exists.
pub struct Cursors {
    arrow: CustomCursor,
    shovel: CustomCursor,
    sword: CustomCursor,
}

impl Cursors {
    /// Loads the three cursors out of `Pharaoh.exe` in the game's data folder. Any failure,
    /// including no exe at all, logs one line and returns `None`: the game keeps the system
    /// cursor and still starts.
    pub fn load(event_loop: &ActiveEventLoop, data: &Path) -> Option<Cursors> {
        let path = data.join("Pharaoh.exe");
        let exe = match osiris_vfs::read(&path) {
            Ok(exe) => exe,
            Err(err) => {
                log::warn!("osiris: no game cursors ({err}), system cursor");
                return None;
            }
        };
        Some(Cursors {
            arrow: load_one(event_loop, &exe, 102, CursorKind::Arrow)?,
            shovel: load_one(event_loop, &exe, 130, CursorKind::Shovel)?,
            sword: load_one(event_loop, &exe, 136, CursorKind::Sword)?,
        })
    }

    pub fn get(&self, kind: CursorKind) -> &CustomCursor {
        match kind {
            CursorKind::Arrow => &self.arrow,
            CursorKind::Shovel => &self.shovel,
            CursorKind::Sword => &self.sword,
        }
    }
}

/// Builds one cursor from the exe's resource group, logging and giving `None` on failure.
fn load_one(
    event_loop: &ActiveEventLoop,
    exe: &[u8],
    group: u16,
    kind: CursorKind,
) -> Option<CustomCursor> {
    match build_one(event_loop, exe, group, kind) {
        Ok(cursor) => Some(cursor),
        Err(why) => {
            log::warn!("osiris: no game cursors ({why}), system cursor");
            None
        }
    }
}

fn build_one(
    event_loop: &ActiveEventLoop,
    exe: &[u8],
    group: u16,
    kind: CursorKind,
) -> Result<CustomCursor, String> {
    let image = osiris_formats::cursor::from_exe(exe, group)
        .ok_or_else(|| format!("cursor group {group} ({kind:?}) does not decode"))?;
    let source = CustomCursor::from_rgba(
        image.rgba,
        image.width.into(),
        image.height.into(),
        image.hot_x.into(),
        image.hot_y.into(),
    )
    .map_err(|err| format!("cursor group {group} ({kind:?}) is not a cursor image: {err:?}"))?;
    Ok(event_loop.create_custom_cursor(source))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tool_and_the_selection_choose_the_cursor() {
        assert_eq!(kind_for(Tool::None, false), CursorKind::Arrow);
        assert_eq!(kind_for(Tool::Clear, false), CursorKind::Shovel);
        assert_eq!(kind_for(Tool::Road, false), CursorKind::Arrow);
        assert_eq!(kind_for(Tool::Build(1), false), CursorKind::Arrow);
        assert_eq!(kind_for(Tool::Clear, true), CursorKind::Sword);
        assert_eq!(kind_for(Tool::None, true), CursorKind::Sword);
    }
}
