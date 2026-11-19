//! The game's own mouse cursor: which picture to show, and the pictures themselves.

use crate::game::Tool;

/// One of the three cursor pictures the game uses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CursorKind {
    Arrow,
    Shovel,
    Sword,
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
