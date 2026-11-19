//! The game's cursor pictures, decoded from the Windows cursor resources inside the
//! player's own `Pharaoh.exe`.
//!
//! A cursor resource is a hotspot followed by a device-independent bitmap (a
//! `BITMAPINFOHEADER`, a palette, the colour bits) and an AND mask. Both bitmaps are stored
//! bottom-up. The mask bit 1 means "show the screen through here"; 0 means "use the colour".

use crate::pe;

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    let b = data.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes([b[0], b[1]]))
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    let b = data.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn i32_at(data: &[u8], at: usize) -> Option<i32> {
    let b = data.get(at..at.checked_add(4)?)?;
    Some(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Bit `n` of a bitmap stored most-significant-bit first inside each byte.
fn bit(data: &[u8], n: usize) -> Option<bool> {
    let byte = *data.get(n / 8)?;
    Some(byte & (0x80 >> (n % 8)) != 0)
}

/// One cursor: its size, the hotspot the pointer aims with, and `width * height` RGBA
/// pixels with (0, 0) at the top left.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CursorImage {
    pub width: u16,
    pub height: u16,
    pub hot_x: u16,
    pub hot_y: u16,
    pub rgba: Vec<u8>,
}

/// Decodes one `RT_CURSOR` resource. Only 1-, 4- and 8-bit pictures are supported, which is
/// every cursor the game ships.
pub fn decode(res: &[u8]) -> Option<CursorImage> {
    let hot_x = u16_at(res, 0)?;
    let hot_y = u16_at(res, 2)?;
    let b = 4;
    let header_size = u32_at(res, b)? as usize;
    let width = i32_at(res, b + 4)?;
    let height2 = i32_at(res, b + 8)?;
    let bits = u16_at(res, b + 14)?;
    let colours_used = u32_at(res, b + 32)?;
    if width <= 0 || height2 <= 0 || height2 % 2 != 0 {
        return None;
    }
    if !matches!(bits, 1 | 4 | 8) {
        return None;
    }
    let width = u16::try_from(width).ok()?;
    let height = u16::try_from(height2 / 2).ok()?;
    let w = width as usize;
    let h = height as usize;

    // The palette: `colours_used` entries, or the full `1 << bits` when the field is zero.
    // Each entry is one byte each of blue, green and red, then a zero.
    let palette_at = b.checked_add(header_size)?;
    let n = if colours_used == 0 {
        1usize << bits
    } else {
        colours_used as usize
    };
    let palette = res.get(palette_at..palette_at.checked_add(n.checked_mul(4)?)?)?;

    // Both bitmaps are stored bottom-up and each row is padded to a 4-byte boundary.
    let colour_stride = ((w.checked_mul(bits as usize)? + 31) / 32) * 4;
    let colour_at = palette_at.checked_add(n * 4)?;
    let mask_stride = ((w + 31) / 32) * 4;
    let mask_at = colour_at.checked_add(colour_stride.checked_mul(h)?)?;
    res.get(colour_at..mask_at.checked_add(mask_stride.checked_mul(h)?)?)?;

    let mut rgba = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        let row = h - 1 - y;
        for x in 0..w {
            if bit(&res[mask_at + row * mask_stride..], x)? {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            } else {
                let colour_row = &res[colour_at + row * colour_stride..];
                let index = match bits {
                    8 => *colour_row.get(x)? as usize,
                    4 => {
                        let byte = *colour_row.get(x / 2)?;
                        if x % 2 == 0 {
                            (byte >> 4) as usize
                        } else {
                            (byte & 0x0F) as usize
                        }
                    }
                    _ => (*colour_row.get(x / 8)? >> (7 - x % 8)) as usize & 1,
                };
                if index >= n {
                    return None;
                }
                let entry = &palette[index * 4..];
                rgba.extend_from_slice(&[entry[2], entry[1], entry[0], 255]);
            }
        }
    }

    Some(CursorImage {
        width,
        height,
        hot_x,
        hot_y,
        rgba,
    })
}

/// Decodes the first cursor of a `RT_GROUP_CURSOR` (an icon group with cursor ids).
pub fn from_exe(exe: &[u8], group: u16) -> Option<CursorImage> {
    let group = pe::resource(exe, 12, group as u32)?;
    // A group directory: reserved, type and count as words, then 14-byte entries whose last
    // two bytes are the id of an `RT_CURSOR` resource.
    if u16_at(group, 4)? == 0 {
        return None;
    }
    let id = u16_at(group, 6 + 12)?;
    decode(pe::resource(exe, 1, id as u32)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An 8x2 1-bit cursor: a black-then-white palette, the bottom row white on its first
    /// four pixels, the top row transparent.
    fn tiny_cursor(bits: u16) -> Vec<u8> {
        let mut res = Vec::new();
        res.extend_from_slice(&3u16.to_le_bytes());
        res.extend_from_slice(&1u16.to_le_bytes());
        res.extend_from_slice(&40u32.to_le_bytes());
        res.extend_from_slice(&8i32.to_le_bytes());
        res.extend_from_slice(&4i32.to_le_bytes());
        res.extend_from_slice(&1u16.to_le_bytes());
        res.extend_from_slice(&bits.to_le_bytes());
        res.extend_from_slice(&0u32.to_le_bytes());
        res.extend_from_slice(&0u32.to_le_bytes());
        res.extend_from_slice(&0i32.to_le_bytes());
        res.extend_from_slice(&0i32.to_le_bytes());
        res.extend_from_slice(&0u32.to_le_bytes());
        res.extend_from_slice(&0u32.to_le_bytes());
        res.extend_from_slice(&[0, 0, 0, 0]);
        res.extend_from_slice(&[255, 255, 255, 0]);
        res.extend_from_slice(&[0xF0, 0, 0, 0]);
        res.extend_from_slice(&[0x0F, 0, 0, 0]);
        res.extend_from_slice(&[0x00, 0, 0, 0]);
        res.extend_from_slice(&[0xFF, 0, 0, 0]);
        res
    }

    fn pixel(image: &CursorImage, x: usize, y: usize) -> &[u8] {
        let at = (y * image.width as usize + x) * 4;
        &image.rgba[at..at + 4]
    }

    #[test]
    fn reads_the_size_and_hotspot() {
        let image = decode(&tiny_cursor(1)).expect("the test cursor decodes");
        assert_eq!((image.width, image.height), (8, 2));
        assert_eq!((image.hot_x, image.hot_y), (3, 1));
        assert_eq!(image.rgba.len(), 8 * 2 * 4);
    }

    #[test]
    fn the_masked_row_is_transparent() {
        let image = decode(&tiny_cursor(1)).expect("the test cursor decodes");
        for x in 0..8 {
            assert_eq!(pixel(&image, x, 0), &[0, 0, 0, 0]);
        }
    }

    #[test]
    fn the_color_row_is_white_then_black() {
        let image = decode(&tiny_cursor(1)).expect("the test cursor decodes");
        for x in 0..4 {
            assert_eq!(pixel(&image, x, 1), &[255, 255, 255, 255]);
        }
        for x in 4..8 {
            assert_eq!(pixel(&image, x, 1), &[0, 0, 0, 255]);
        }
    }

    #[test]
    fn a_24_bit_picture_gives_nothing() {
        assert_eq!(decode(&tiny_cursor(24)), None);
    }

    #[test]
    fn a_short_buffer_gives_nothing() {
        assert_eq!(decode(&[0u8; 5]), None);
    }

    /// The real `Pharaoh.exe`, when the machine has one: the three cursors the game uses
    /// must decode to the size, hotspot and colours measured on the player's copy. Skipped
    /// (and so passing) when `OSIRIS_TEST_DATA` or the exe is missing.
    #[test]
    fn the_players_exe_has_the_three_cursors() {
        let Ok(dir) = std::env::var("OSIRIS_TEST_DATA") else {
            return;
        };
        let Ok(exe) = std::fs::read(std::path::Path::new(&dir).join("Pharaoh.exe")) else {
            return;
        };
        // group, name, hotspot, opaque pixels, white pixels, black pixels
        let expected = [
            (102, "arrow", (0, 0), 135, 81, 54),
            (130, "shovel", (8, 31), 301, 142, 159),
            (136, "sword", (0, 0), 168, 82, 86),
        ];
        for (group, name, hot, opaque, white, black) in expected {
            let image = from_exe(&exe, group)
                .unwrap_or_else(|| panic!("group {group} ({name}) does not decode"));
            let pixels = image.rgba.chunks_exact(4);
            let count = |want: [u8; 4]| pixels.clone().filter(|p| *p == want).count();
            let opaque_pixels = pixels.clone().filter(|p| p[3] == 255).count();
            let (white_pixels, black_pixels) = (count([255, 255, 255, 255]), count([0, 0, 0, 255]));
            eprintln!(
                "group {group} ({name}): {}x{}, hotspot {},{}: {opaque_pixels} opaque, \
                 {white_pixels} white, {black_pixels} black",
                image.width, image.height, image.hot_x, image.hot_y
            );
            assert_eq!((image.width, image.height), (32, 32), "group {group} ({name}) size");
            assert_eq!((image.hot_x, image.hot_y), hot, "group {group} ({name}) hotspot");
            assert_eq!(opaque_pixels, opaque, "group {group} ({name}) opaque pixels");
            assert_eq!(white_pixels, white, "group {group} ({name}) white pixels");
            assert_eq!(black_pixels, black, "group {group} ({name}) black pixels");
        }
    }
}
