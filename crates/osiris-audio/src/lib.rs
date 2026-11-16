//! Music, sound effects, speech and city sounds for Osiris.
//!
//! [`Audio`] is the single entry point: it owns every rodio handle the crate needs (the
//! output device, a music player, a speech player and the city's ambience player) and
//! exposes plain methods for the game loop to call. Which sound belongs to what is in
//! [`city`]. There is no global
//! or process-wide audio state; everything lives on the `Audio` value the caller holds.
//!
//! If no audio output device is available, [`Audio::new`] still succeeds: it returns an
//! `Audio` whose methods are all silent no-ops, so callers do not need to special-case
//! "no sound card" environments (headless builds, CI, etc.).
//!
//! ```no_run
//! use std::path::Path;
//! use osiris_audio::{Audio, Track};
//!
//! let audio = Audio::new(Path::new("PharaohData")).expect("audio init");
//! audio.play_music(&Track::new("Ra"));
//! audio.update_music(1200); // called periodically with the current city population
//! audio.play_effect("BUTTON.WAV");
//! audio.play_city_sound("well.wav", 0.5); // a well, in the middle of the view
//! ```

pub mod city;
pub mod error;
mod music;
mod stream;
#[cfg(test)]
mod test_support;

pub use error::{Error, Result};
pub use music::Track;
pub use stream::{StreamFeed, StreamSound};

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rodio::Source as _;

/// Entry point for all audio playback: music, one-shot effects, speech and looping city
/// ambience. See the [module docs](crate) for an overview.
///
/// Cheap to pass around by `&Audio`; every method takes `&self`.
/// The music's starting volume, below effects and speech.
pub const DEFAULT_MUSIC_VOLUME: f32 = 0.35;

pub struct Audio {
    inner: Option<Inner>,
}

struct Inner {
    game_dir: PathBuf,
    // Kept alive only to keep the output stream open; dropping it stops all playback.
    _device: rodio::MixerDeviceSink,
    mixer: rodio::mixer::Mixer,
    music_player: rodio::Player,
    speech_player: rodio::Player,

    music_rows: Vec<music::MusicRow>,
    music_current: Mutex<Option<String>>,

    /// The city's ambience (`AUDIO/Ambient`), its file and how far it has faded in.
    ambient_player: rodio::Player,
    ambient: Mutex<(Option<String>, f32)>,
    /// Files found (or not) under `AUDIO`, whatever the case of their names.
    found: Mutex<HashMap<PathBuf, Option<PathBuf>>>,

    effects_volume: Mutex<f32>,
    /// The volume of the city's sounds and ambience.
    city_volume: Mutex<f32>,
}

impl Audio {
    /// Opens the default audio output device and prepares playback rooted at `game_dir`
    /// (the original game's data directory, e.g. `PharaohData`, containing `music.txt` and
    /// an `AUDIO/` folder with `Music/`, `Ambient/`, `Wavs/` and `Voice/`).
    ///
    /// Never fails because a sound device is unavailable: in that case this returns `Ok` with
    /// an `Audio` that silently does nothing.
    pub fn new(game_dir: &Path) -> Result<Audio> {
        let device = match rodio::DeviceSinkBuilder::open_default_sink() {
            Ok(device) => device,
            Err(_) => return Ok(Audio { inner: None }),
        };

        let mixer = device.mixer().clone();
        let music_player = rodio::Player::connect_new(&mixer);
        // Full-volume music drowns the city's sounds; start it well below them.
        music_player.set_volume(DEFAULT_MUSIC_VOLUME);
        let speech_player = rodio::Player::connect_new(&mixer);
        let ambient_player = rodio::Player::connect_new(&mixer);

        let music_rows = osiris_vfs::read_to_string(game_dir.join("music.txt"))
            .map(|text| music::parse_music_txt(&text))
            .unwrap_or_else(|_| {
                eprintln!(
                    "osiris-audio: no music.txt under {game_dir:?}, city music selection disabled"
                );
                Vec::new()
            });

        Ok(Audio {
            inner: Some(Inner {
                game_dir: game_dir.to_path_buf(),
                _device: device,
                mixer,
                music_player,
                speech_player,
                music_rows,
                music_current: Mutex::new(None),
                ambient_player,
                ambient: Mutex::new((None, 0.0)),
                found: Mutex::new(HashMap::new()),
                effects_volume: Mutex::new(1.0),
                city_volume: Mutex::new(1.0),
            }),
        })
    }

    /// Whether an audio output device was opened. A silent `Audio` (no device) returns `false`,
    /// so the browser can say so instead of pretending to play.
    pub fn has_output(&self) -> bool {
        self.inner.is_some()
    }

    /// Plays `track` as the current music, replacing whatever was playing.
    pub fn play_music(&self, track: &Track) {
        let Some(inner) = &self.inner else { return };
        let mut current = inner.music_current.lock().unwrap();
        inner.start_music_locked(track.filename(), &mut current);
    }

    /// Call periodically (e.g. once a game tick) with the current city population. Picks city
    /// music the way the original engine does: keeps the current tune playing as long as it
    /// still falls within its `music.txt` population bracket, otherwise picks a new track at
    /// random from the brackets that match `population`. See the [`music`] module docs for
    /// the exact rule and its known simplifications versus the original per-mission behavior.
    pub fn update_music(&self, population: i32) {
        let Some(inner) = &self.inner else { return };
        if inner.music_rows.is_empty() {
            return;
        }

        let mut current = inner.music_current.lock().unwrap();
        let still_fits = current
            .as_deref()
            .is_some_and(|file| music::track_fits(&inner.music_rows, file, population));
        if still_fits && !inner.music_player.empty() {
            return;
        }

        if let Some(row) = music::pick_track(&inner.music_rows, population, current.as_deref()) {
            let filename = row.file.clone();
            inner.start_music_locked(&filename, &mut current);
        }
    }

    /// Plays a plague's looping ambient track (`path` under `AUDIO/`, e.g.
    /// `"Ambient/Frogs.mp3"`) in place of the music, as the original does, or with
    /// `None` stops it; [`Audio::update_music`] then picks music again.
    pub fn play_plague_track(&self, path: Option<&str>) {
        let Some(inner) = &self.inner else { return };
        let mut current = inner.music_current.lock().unwrap();
        inner.music_player.stop();
        *current = None;
        let Some(path) = path else { return };
        let full = inner.audio_path(path);
        match open_looped_source(&full) {
            Ok(source) => inner.music_player.append(source),
            Err(err) => eprintln!("osiris-audio: could not play {full:?}: {err}"),
        }
    }

    /// Stops music playback immediately.
    pub fn stop_music(&self) {
        let Some(inner) = &self.inner else { return };
        inner.music_player.stop();
        *inner.music_current.lock().unwrap() = None;
    }

    /// Sets the music playback volume (`0.0` silent .. `1.0` full).
    pub fn set_music_volume(&self, volume: f32) {
        if let Some(inner) = &self.inner {
            inner.music_player.set_volume(volume.clamp(0.0, 1.0));
        }
    }

    /// Sets the volume applied to future [`Audio::play_effect`] calls (`0.0` .. `1.0`).
    pub fn set_effects_volume(&self, volume: f32) {
        if let Some(inner) = &self.inner {
            *inner.effects_volume.lock().unwrap() = volume.clamp(0.0, 1.0);
        }
    }

    /// Sets the volume the city's ambient sounds are scaled by (`0.0` .. `1.0`).
    pub fn set_city_volume(&self, volume: f32) {
        if let Some(inner) = &self.inner {
            *inner.city_volume.lock().unwrap() = volume.clamp(0.0, 1.0);
        }
    }

    /// Sets the speech/briefing playback volume (`0.0` .. `1.0`).
    pub fn set_speech_volume(&self, volume: f32) {
        if let Some(inner) = &self.inner {
            inner.speech_player.set_volume(volume.clamp(0.0, 1.0));
        }
    }

    /// Plays a one-shot UI/effect sound (button clicks, building placement, etc). Several can
    /// overlap; each call is independent.
    ///
    /// `name_or_path` is resolved as follows:
    /// - An absolute path is used as-is.
    /// - A path with more than one component (e.g. `"Ambient/HOUSING1.MP3"`) is resolved
    ///   relative to `AUDIO/`.
    /// - A bare filename (e.g. `"BUTTON.WAV"`, the UI click sound; `"BUILD.WAV"`, building
    ///   placement; `"NO.WAV"`, invalid action) is resolved relative to `AUDIO/Wavs/`, where
    ///   the original ships its UI sounds.
    pub fn play_effect(&self, name_or_path: impl AsRef<Path>) {
        let Some(inner) = &self.inner else { return };
        inner.play_effect(name_or_path.as_ref());
    }

    /// Plays a mission-briefing voice line. `path` is relative to `AUDIO/Voice/` (e.g.
    /// `"Mission/01/briefing.wav"`), or an absolute path. Replaces any speech currently
    /// playing.
    pub fn play_speech(&self, path: impl AsRef<Path>) {
        let Some(inner) = &self.inner else { return };
        inner.play_speech(path.as_ref());
    }

    /// Starts a sound whose samples (interleaved, `channels` of them at `rate`) are
    /// pushed while it plays, as a movie's are, at `volume` (`0.0` .. `1.0`). Without
    /// an output device it plays nothing and has no position.
    pub fn play_stream(&self, rate: u32, channels: u16, volume: f32) -> StreamSound {
        match &self.inner {
            Some(inner) => StreamSound::play(&inner.mixer, rate, channels, volume),
            None => StreamSound::silent(rate, channels),
        }
    }

    /// Plays one of the city's sounds (`AUDIO/Wavs/<name>`) at the city-sounds volume,
    /// panned by `pan` from 0 (left) to 1 (right). A name the data lacks plays nothing,
    /// as in the original.
    pub fn play_city_sound(&self, name: &str, pan: f32) {
        let Some(inner) = &self.inner else { return };
        let volume = *inner.city_volume.lock().unwrap();
        inner.play_panned(&Path::new("Wavs").join(name), volume, pan);
    }

    /// Plays a sound effect (`AUDIO/Wavs/<name>`) at `scale` of the effects volume,
    /// panned by `pan` from 0 (left) to 1 (right); a missing file plays nothing.
    pub fn play_effect_panned(&self, name: &str, scale: f32, pan: f32) {
        let Some(inner) = &self.inner else { return };
        let volume = *inner.effects_volume.lock().unwrap() * scale;
        inner.play_panned(&Path::new("Wavs").join(name), volume, pan);
    }

    /// Says a walker's phrase (`AUDIO/Voice/Walker/<name>`) on the speech channel.
    pub fn play_walker_voice(&self, name: &str) {
        let Some(inner) = &self.inner else { return };
        if let Some(path) = inner.find(&Path::new("Voice").join("Walker").join(name)) {
            inner.play_speech(&path);
        }
    }

    /// Keeps the city's ambience (`AUDIO/Ambient/<name>`) going; call it every frame the
    /// city is shown, with `None` when it should be silent. A new ambience starts
    /// quiet and fades in, five points of a hundred a frame at 30 frames a second, up
    /// to the city-sounds volume; one that ends starts again the same way. `None` stops
    /// it at once.
    pub fn update_city_ambient(&self, name: Option<&str>, dt: f32) {
        let Some(inner) = &self.inner else { return };
        inner.update_ambient(name, dt);
    }
}

impl Inner {
    fn audio_path(&self, sub: impl AsRef<Path>) -> PathBuf {
        self.game_dir.join("AUDIO").join(sub.as_ref())
    }

    fn start_music_locked(&self, filename: &str, current: &mut Option<String>) {
        let path = self.audio_path(Path::new("Music").join(filename));
        match open_source(&path) {
            Ok(source) => {
                self.music_player.stop();
                self.music_player.append(source);
                *current = Some(filename.to_string());
            }
            Err(err) => eprintln!("osiris-audio: could not play music {path:?}: {err}"),
        }
    }

    fn resolve_effect_path(&self, p: &Path) -> PathBuf {
        if p.is_absolute() {
            return p.to_path_buf();
        }
        let has_subdir = p
            .parent()
            .is_some_and(|parent| !parent.as_os_str().is_empty());
        if has_subdir {
            self.audio_path(p)
        } else {
            self.audio_path(Path::new("Wavs").join(p))
        }
    }

    fn play_effect(&self, name_or_path: &Path) {
        let mut path = self.resolve_effect_path(name_or_path);
        if !osiris_vfs::exists(&path)
            && let Ok(sub) = path.strip_prefix(self.game_dir.join("AUDIO"))
            && let Some(found) = self.find(&sub.to_path_buf())
        {
            path = found;
        }
        match open_source(&path) {
            Ok(source) => {
                let volume = *self.effects_volume.lock().unwrap();
                self.mixer.add(source.amplify(volume));
            }
            Err(err) => eprintln!("osiris-audio: could not play effect {path:?}: {err}"),
        }
    }

    fn play_speech(&self, path: &Path) {
        let full = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.audio_path(Path::new("Voice").join(path))
        };
        match open_source(&full) {
            Ok(source) => {
                self.speech_player.stop();
                self.speech_player.append(source);
            }
            Err(err) => eprintln!("osiris-audio: could not play speech {full:?}: {err}"),
        }
    }

    /// `sub` under `AUDIO`, matching each part's name without regard to case (the
    /// data mixes `WELL.WAV` and `well_r.wav`), or `None` if there is no such file.
    fn find(&self, sub: &Path) -> Option<PathBuf> {
        let mut found = self.found.lock().unwrap();
        if let Some(hit) = found.get(sub) {
            return hit.clone();
        }
        let hit = find_ignoring_case(&self.game_dir.join("AUDIO"), sub);
        found.insert(sub.to_path_buf(), hit.clone());
        hit
    }

    fn play_panned(&self, sub: &Path, volume: f32, pan: f32) {
        let Some(path) = self.find(sub) else { return };
        if volume <= 0.0 {
            return;
        }
        match open_source(&path) {
            Ok(source) => {
                let pan = pan.clamp(0.0, 1.0);
                let sides = vec![(2.0 * (1.0 - pan)).min(1.0), (2.0 * pan).min(1.0)];
                self.mixer.add(rodio::source::ChannelVolume::new(source.amplify(volume), sides));
            }
            Err(err) => eprintln!("osiris-audio: could not play {path:?}: {err}"),
        }
    }

    fn update_ambient(&self, name: Option<&str>, dt: f32) {
        let mut ambient = self.ambient.lock().unwrap();
        let Some(name) = name else {
            if ambient.0.take().is_some() {
                self.ambient_player.stop();
            }
            ambient.1 = 0.0;
            return;
        };
        if ambient.0.as_deref() != Some(name) || self.ambient_player.empty() {
            self.ambient_player.stop();
            self.ambient_player.set_volume(0.0);
            ambient.0 = Some(name.to_owned());
            ambient.1 = 0.0;
            if let Some(path) = self.find(&Path::new("Ambient").join(name)) {
                match open_source(&path) {
                    Ok(source) => self.ambient_player.append(source),
                    Err(err) => eprintln!("osiris-audio: could not play {path:?}: {err}"),
                }
            }
            return;
        }
        // Five points a frame at 30 frames a second, never above the city volume.
        let cap = *self.city_volume.lock().unwrap();
        ambient.1 = (ambient.1 + 1.5 * dt).min(cap);
        self.ambient_player.set_volume(ambient.1);
    }
}

/// `sub` under `root`, each part of it matched without regard to case.
fn find_ignoring_case(root: &Path, sub: &Path) -> Option<PathBuf> {
    let mut path = root.to_path_buf();
    for part in sub.components() {
        let exact = path.join(part);
        if osiris_vfs::exists(&exact) {
            path = exact;
            continue;
        }
        let want = part.as_os_str();
        let dir = osiris_vfs::read_dir(&path).ok()?;
        path = dir.into_iter().find(|e| e.file_name().eq_ignore_ascii_case(want))?.path_buf();
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A mono 16-bit PCM WAV of `samples` silent samples, at 8000 Hz.
    fn wav_bytes(samples: usize) -> Vec<u8> {
        const RATE: u32 = 8000;
        let data_len = (samples * 2) as u32;
        let mut bytes = Vec::with_capacity(44 + data_len as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
        bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
        bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
        bytes.extend_from_slice(&RATE.to_le_bytes());
        bytes.extend_from_slice(&(RATE * 2).to_le_bytes()); // bytes per second
        bytes.extend_from_slice(&2u16.to_le_bytes()); // bytes per frame
        bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.resize(44 + data_len as usize, 0);
        bytes
    }

    /// A directory of its own for a test, removed afterwards.
    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osiris-audio-{name}-{}", std::process::id()));
        let _ = osiris_vfs::remove_dir_all(&dir);
        osiris_vfs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Sound files are read through `osiris_vfs`, so the browser's store decodes as disks do.
    #[test]
    fn open_source_decodes_a_wav_from_the_store() {
        let dir = scratch_dir("open-source");
        let path = dir.join("beep.wav");
        osiris_vfs::write(&path, wav_bytes(800)).unwrap();

        let samples = open_source(&path).unwrap().count();
        assert!(samples > 0, "decoded no samples");
        assert_eq!(samples, 800);

        osiris_vfs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_source_reports_a_missing_file_as_io() {
        let dir = scratch_dir("missing");
        let path = dir.join("nothere.wav");

        match open_source(&path) {
            Err(Error::Io { path: reported, .. }) => assert_eq!(reported, path),
            Err(other) => panic!("expected Error::Io, got {other:?}"),
            Ok(_) => panic!("expected Error::Io, got a decoder"),
        }

        osiris_vfs::remove_dir_all(&dir).unwrap();
    }

    /// The shipped data spells names in either case; the original's tables find them.
    #[test]
    fn tables_find_the_data_whatever_the_case() {
        let Some(audio) = test_support::pharaoh_audio_dir() else {
            eprintln!("skipping: PharaohData/AUDIO not found");
            return;
        };
        for name in ["well.wav", "well_r.wav", "tem_ra_l.wav", "shr_osiris.wav", "water1.wav"] {
            assert!(find_ignoring_case(&audio, &Path::new("Wavs").join(name)).is_some(), "{name}");
        }
        assert!(find_ignoring_case(&audio, Path::new("Ambient/housing1.mp3")).is_some());
        assert!(find_ignoring_case(&audio, Path::new("Voice/Walker/doctor_g01.wav")).is_some());
        assert!(find_ignoring_case(&audio, Path::new("Wavs/plaza1.wav")).is_none());
    }

    /// The same lookup against a directory made in the test: no game file is involved.
    #[test]
    fn find_ignoring_case_walks_a_temp_directory() {
        let dir = scratch_dir("case");
        osiris_vfs::create_dir_all(&dir.join("Wavs")).unwrap();
        osiris_vfs::write(&dir.join("Wavs/WELL.WAV"), wav_bytes(1)).unwrap();

        // On a case-insensitive disk the exact name already resolves, which is fine: either way
        // the lookup ends at the file that is really there.
        let found = find_ignoring_case(&dir, Path::new("Wavs/well.wav")).expect("lookup found no file");
        assert!(osiris_vfs::is_file(&found), "{found:?} is not the file");
        assert_eq!(found.file_name().unwrap().to_string_lossy().to_ascii_uppercase(), "WELL.WAV");
        assert_eq!(find_ignoring_case(&dir, Path::new("Wavs/plaza1.wav")), None);

        osiris_vfs::remove_dir_all(&dir).unwrap();
    }

    /// A machine with no sound device, or a directory with no game data in it, still starts:
    /// every sound call then does nothing.
    #[test]
    fn audio_new_succeeds_without_game_data() {
        let dir = scratch_dir("no-game-data");

        let audio = Audio::new(&dir).expect("Audio::new failed");
        // Either answer is fine here; what matters is that no failure came out.
        let _has_output = audio.has_output();
        audio.play_effect("BUTTON.WAV");
        audio.update_music(0);

        osiris_vfs::remove_dir_all(&dir).unwrap();
    }
}

type FileDecoder = rodio::Decoder<osiris_vfs::Reader>;
type FileLoopedDecoder = rodio::decoder::LoopedDecoder<osiris_vfs::Reader>;

/// Opens `path` through the virtual file system, so the same code reads the game's data from
/// disk on desktop and from the page's in-memory store in the browser.
fn open_source(path: &Path) -> Result<FileDecoder> {
    let len = byte_len(path)?;
    let reader = osiris_vfs::open(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })?;
    rodio::Decoder::builder()
        .with_data(reader)
        .with_byte_len(len)
        .with_seekable(true)
        .build()
        .map_err(|source| Error::Decode {
            path: path.to_path_buf(),
            source,
        })
}

fn open_looped_source(path: &Path) -> Result<FileLoopedDecoder> {
    let reader = osiris_vfs::open(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })?;
    rodio::Decoder::new_looped(reader).map_err(|source| Error::Decode {
        path: path.to_path_buf(),
        source,
    })
}

/// The length of `path` in bytes, which the decoder needs to seek and to work out durations.
fn byte_len(path: &Path) -> Result<u64> {
    osiris_vfs::len(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })
}
