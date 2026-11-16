//! A generated beep, so the browser's smoke test can check that sound plays without a game
//! file being involved. Nothing here is game data: the WAV is built from a sine wave in code.

/// Sample rate of the generated beep, in hertz.
pub const BEEP_RATE: u32 = 44_100;

/// How many samples the beep holds: a fifth of a second.
pub const BEEP_SAMPLES: usize = BEEP_RATE as usize / 5;

/// The frequency of the tone, in hertz.
const BEEP_HERTZ: f32 = 440.0;

/// A mono, 16-bit PCM WAV holding a quiet 440 Hz tone for [`BEEP_SAMPLES`] samples.
pub fn beep_wav() -> Vec<u8> {
    let data_len = (BEEP_SAMPLES * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);

    // The 44-byte canonical WAV header: RIFF size, then the fmt chunk, then the data chunk.
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
    bytes.extend_from_slice(&BEEP_RATE.to_le_bytes());
    bytes.extend_from_slice(&(BEEP_RATE * 2).to_le_bytes()); // bytes per second
    bytes.extend_from_slice(&2u16.to_le_bytes()); // bytes per frame
    bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());

    for i in 0..BEEP_SAMPLES {
        let t = i as f32 / BEEP_RATE as f32;
        let sample = (t * BEEP_HERTZ * std::f32::consts::TAU).sin() * 0.25;
        bytes.extend_from_slice(&((sample * i16::MAX as f32) as i16).to_le_bytes());
    }

    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beep_wav_is_a_wav_of_the_right_size() {
        let bytes = beep_wav();
        assert!(bytes.starts_with(b"RIFF"), "the file does not start with RIFF");
        assert_eq!(bytes.len(), 44 + 2 * BEEP_SAMPLES);
    }
}
