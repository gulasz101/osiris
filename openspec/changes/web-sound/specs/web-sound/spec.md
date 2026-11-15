# Delta for web-sound

## ADDED Requirements

### Requirement: Sound plays in the browser
The browser build SHALL open a WebAudio output and play music, effects, speech and ambience from the in-memory store, as the desktop build plays them from disk.

#### Scenario: effect from the in-memory store
- GIVEN the page open in Chromium and a generated WAV mounted at `/PharaohData/AUDIO/Wavs/osiris_beep.wav`
- WHEN the game plays the effect `osiris_beep.wav`
- THEN the sound is decoded from the in-memory store and the audio context state is `running`

#### Scenario: no output device
- GIVEN a browser without an audio output
- WHEN the game starts
- THEN `Audio::new` still returns `Ok` and every sound call does nothing

### Requirement: Audio starts after a user gesture
The page SHALL resume a suspended audio context on the player's next click, key press or touch.

#### Scenario: context suspended at creation
- GIVEN an audio context that was created before any gesture and is `suspended`
- WHEN the player clicks the page
- THEN the context becomes `running`

### Requirement: Sound files are read through the virtual file system
`osiris-audio` SHALL open sound files with `osiris_vfs` only, never with `std::fs`.

#### Scenario: same code on desktop
- GIVEN a WAV file in a temporary directory
- WHEN `open_source` opens it on desktop
- THEN it decodes with the same samples as before the change
