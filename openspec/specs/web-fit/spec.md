# web-fit Specification

## Purpose
TBD - created by archiving change web-fit. Update Purpose after archive.

## Requirements

### Requirement: The canvas fills the window
When the game starts, the page SHALL give the canvas a CSS size equal to the browser window's
inner size and a bitmap size equal to that CSS size times `devicePixelRatio`, rounded down, in
both dimensions. It SHALL log `osiris web: set canvas to <bitmap width>x<bitmap height>`. The
page SHALL NOT choose a fixed size of its own.

#### Scenario: a 1920x1080 window
- GIVEN a browser window of 1920x1080 and a `devicePixelRatio` of 1
- WHEN the game starts
- THEN the canvas is 1920x1080 CSS pixels and 1920x1080 bitmap pixels
- AND the console shows `osiris web: set canvas to 1920x1080`

#### Scenario: a window on a high-density screen
- GIVEN a browser window of 1280x720 and a `devicePixelRatio` of 2
- WHEN the game starts
- THEN the canvas is 1280x720 CSS pixels and 2560x1440 bitmap pixels

### Requirement: A window change resizes the canvas and the surface
When the browser window changes size, the page SHALL apply the same CSS and bitmap sizing rule
again, and the program SHALL resize the render surface to the canvas's new device-pixel size,
so the game keeps filling the window with no black edge left over from the old size. In the
browser build the program SHALL log `osiris web: resize to <width>x<height>` after resizing.

#### Scenario: the window gets smaller
- GIVEN the game running in a 1920x1080 window
- WHEN the window is changed to 1280x720
- THEN the console shows `osiris web: set canvas to 1280x720`
- AND the console shows `osiris web: resize to 1280x720`
- AND the city fills the 1280x720 window

### Requirement: A window below the minimum keeps 1024x768 and the page scrolls
When the browser window is smaller than 1024x768 in both directions, the canvas SHALL keep a
1024x768 size and the page SHALL scroll, rather than the game shrinking further. A window that
is short in only one direction SHALL still be filled.

#### Scenario: a small window
- GIVEN a browser window of 800x600
- WHEN the game starts
- THEN the canvas is 1024x768 and the page scrolls to show all of it

#### Scenario: a window short in one direction
- GIVEN a browser window of 1280x720
- WHEN the game starts
- THEN the canvas is 1280x720 and the game fills the window

### Requirement: The game can go full screen
The page SHALL offer a "Fullscreen" control and SHALL treat the F11 key inside the page as the
same request. Both SHALL put the canvas into full screen with `canvas.requestFullscreen()` when
the page is not in full screen, and SHALL leave full screen when it is. Escape leaving full
screen SHALL be left to the browser. When the page leaves full screen, the canvas SHALL be
sized to the window again.

#### Scenario: the button
- GIVEN the game running in the page
- WHEN the player clicks "Fullscreen"
- THEN the page calls `canvas.requestFullscreen()`

#### Scenario: F11 before the canvas has the keyboard
- GIVEN the game running and the keyboard focus anywhere on the page
- WHEN the player presses F11
- THEN the page calls `canvas.requestFullscreen()`

#### Scenario: Escape leaves full screen and the game still fills the window
- GIVEN the page in full screen
- WHEN the player presses Escape
- THEN the browser leaves full screen and the canvas is sized to the window again

### Requirement: Only the game is visible once it starts
Once the game has started the page SHALL show only the canvas, with the start page's status
line, folder field and links hidden. It SHALL keep a small control in a corner holding the
"Fullscreen" control and a link that brings the start page back over the game, and that link
SHALL hide it again.

#### Scenario: the start page goes away
- GIVEN the player has chosen their Pharaoh folder and the game has started
- WHEN the first frame is drawn
- THEN only the canvas is on the screen, with the corner control on top of it

#### Scenario: the link brings the page back
- GIVEN the game running with the corner control
- WHEN the player clicks the page link
- THEN the start page with its status line and folder field is back over the game
- AND clicking the link again returns to the game alone

### Requirement: A smoke run proves the fit
The smoke test SHALL accept `SMOKE_VIEWPORT=WxH` with `SMOKE_MISSION=menu`: open the page at
that window size, start the game through the page's own folder picker, check the canvas log
lines and the filled screenshot, then change the window to 1280x720 and check the smaller
canvas.

#### Scenario: 1920x1080 then 1280x720
- GIVEN a machine with the Pharaoh files in `OSIRIS_DATA`
- WHEN `SMOKE_VIEWPORT=1920x1080 SMOKE_MISSION=menu scripts/web-smoke.sh` runs
- THEN the console shows `osiris web: set canvas to 1920x1080` and `osiris web: resize to 1920x1080`
- AND the canvas fills the 1920x1080 window and a city runs two months
- AND the screenshot is 1920x1080 with no black border wider than 8 pixels at any edge
- AND after the window becomes 1280x720 the console shows `osiris web: set canvas to 1280x720`
- AND the run prints `osiris web: viewport OK (1920x1080 then 1280x720)`
