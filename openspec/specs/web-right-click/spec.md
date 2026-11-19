# web-right-click Specification

## Purpose

Let the player put down the tool in hand, or cancel a drag, with one right click, so a tool
picked from the sidebar never traps them in the browser or on the desktop.

## Requirements

### Requirement: One right-click drops the tool in hand
When the player holds a tool (`Tool::Road`, `Tool::Clear` or `Tool::Build(_)`) and no review,
advisor, info window, dialog, panel, confirmation or selected company or ship is open, one
right-click SHALL set the tool to `Tool::None` and close the open sidebar menu. When a left-drag
placement is in progress, the right-click SHALL cancel only the drag and keep the tool.

#### Scenario: a building is in hand and the sidebar menu is open
- GIVEN the player picked a house from the sidebar and the sidebar menu is still open
- WHEN the player right-clicks the map once
- THEN the tool is `Tool::None`
- AND the sidebar menu is closed
- AND no tile info window opens

#### Scenario: a row of roads is being dragged
- GIVEN the player holds the road tool and is dragging a row with the left button
- WHEN the player right-clicks
- THEN the dragged row is cancelled
- AND the road tool is still in hand

#### Scenario: the browser build
- GIVEN the game runs in the page and the player holds a tool
- WHEN the player right-clicks the canvas once
- THEN `debug_city()` reports `"tool":"none"`
- AND the browser's context menu does not open
