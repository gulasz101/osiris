//! One resource out of a Windows `.exe` (PE) image, used for the game's cursor pictures
//! stored inside the player's own `Pharaoh.exe`.
//!
//! Layout follows Microsoft's "PE Format": DOS header, `PE\0\0` signature, COFF header,
//! optional header with the data directories, section table, and a resource tree of
//! three directories (type, id, language) ending in a data entry. Every read is
//! bounds-checked, so a truncated or malformed image gives `None` instead of a panic.

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    let b = data.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes([b[0], b[1]]))
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    let b = data.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// The image's section table, which maps a relative virtual address to a file offset.
struct Sections<'a> {
    exe: &'a [u8],
    table: usize,
    count: usize,
}

impl Sections<'_> {
    fn offset(&self, rva: u32) -> Option<usize> {
        for i in 0..self.count {
            let s = self.table.checked_add(i.checked_mul(40)?)?;
            let virtual_size = u32_at(self.exe, s + 8)?;
            let virtual_address = u32_at(self.exe, s + 12)?;
            let raw_size = u32_at(self.exe, s + 16)?;
            let raw_pointer = u32_at(self.exe, s + 20)?;
            // Some linkers leave `virtual_size` zero in images; the raw size is the
            // fallback then, which is why the larger of the two bounds the section.
            let span = virtual_size.max(raw_size);
            if rva >= virtual_address && rva - virtual_address < span {
                return Some(rva.wrapping_sub(virtual_address).wrapping_add(raw_pointer) as usize);
            }
        }
        None
    }
}

/// The file offset of a resource directory table's entries, given the table's offset.
fn entries(exe: &[u8], dir: usize) -> Option<(usize, usize)> {
    let named = u16_at(exe, dir.checked_add(12)?)? as usize;
    let ids = u16_at(exe, dir.checked_add(14)?)? as usize;
    Some((dir.checked_add(16)?, named.checked_add(ids)?))
}

/// The first `target` of a resource directory whose name or id equals `id`.
fn find(exe: &[u8], dir: usize, id: u32) -> Option<u32> {
    let (first, count) = entries(exe, dir)?;
    for i in 0..count {
        let at = first.checked_add(i.checked_mul(8)?)?;
        if u32_at(exe, at)? == id {
            return u32_at(exe, at.checked_add(4)?);
        }
    }
    None
}

/// Reads one resource of `kind` (for example `1` = `RT_CURSOR`) and `id` from a PE image.
///
/// Walks the resource tree: the root, the type directory, the id directory, then the first
/// language entry, which points at the data. Returns `None` when the image is not a PE, the
/// resource is absent, or any offset falls outside the file.
pub fn resource(exe: &[u8], kind: u32, id: u32) -> Option<&[u8]> {
    if !exe.starts_with(b"MZ") {
        return None;
    }
    let pe = u32_at(exe, 0x3C)? as usize;
    // "PE\0\0" as a little-endian word.
    if u32_at(exe, pe)? != 0x0000_4550 {
        return None;
    }
    let coff = pe.checked_add(4)?;
    let sections = Sections {
        exe,
        table: coff
            .checked_add(20)?
            .checked_add(u16_at(exe, coff + 16)? as usize)?,
        count: u16_at(exe, coff + 2)? as usize,
    };
    let opt = coff.checked_add(20)?;
    let dirs = match u16_at(exe, opt)? {
        0x10B => opt.checked_add(96)?,
        0x20B => opt.checked_add(112)?,
        _ => return None,
    };
    let rsrc_rva = u32_at(exe, dirs + 16)?;
    let rsrc = sections.offset(rsrc_rva)?;

    let kind_dir = rsrc.checked_add((find(exe, rsrc, kind)? & 0x7FFF_FFFF) as usize)?;
    let id_dir = rsrc.checked_add((find(exe, kind_dir, id)? & 0x7FFF_FFFF) as usize)?;
    // The language directory: take its first entry, whatever the language.
    let (first, count) = entries(exe, id_dir)?;
    if count == 0 {
        return None;
    }
    let target = u32_at(exe, first.checked_add(4)?)?;
    if target & 0x8000_0000 != 0 {
        return None;
    }
    let data = rsrc.checked_add(target as usize)?;
    let data_rva = u32_at(exe, data)?;
    let size = u32_at(exe, data.checked_add(4)?)? as usize;
    let start = sections.offset(data_rva)?;
    exe.get(start..start.checked_add(size)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_u16(buf: &mut [u8], at: usize, value: u16) {
        buf[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u32(buf: &mut [u8], at: usize, value: u32) {
        buf[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    /// A minimal PE32 image with one section and one resource: `kind`/`id` whose bytes are
    /// `data`. The resource tree sits at file offset 0x200 (rva 0x1000), the data after it.
    fn tiny_pe(kind: u32, id: u32, data: &[u8]) -> Vec<u8> {
        let mut exe = vec![0u8; 0x400];
        exe[0..2].copy_from_slice(b"MZ");
        put_u32(&mut exe, 0x3C, 0x40);
        exe[0x40..0x44].copy_from_slice(b"PE\0\0");
        put_u16(&mut exe, 0x44 + 2, 1);
        put_u16(&mut exe, 0x44 + 16, 0xE0);
        put_u16(&mut exe, 0x58, 0x10B);
        put_u32(&mut exe, 0xC8, 0x1000);
        put_u32(&mut exe, 0x138 + 8, 0x200);
        put_u32(&mut exe, 0x138 + 12, 0x1000);
        put_u32(&mut exe, 0x138 + 16, 0x200);
        put_u32(&mut exe, 0x138 + 20, 0x200);
        put_u16(&mut exe, 0x200 + 14, 1);
        put_u32(&mut exe, 0x210, kind);
        put_u32(&mut exe, 0x214, 0x8000_0018);
        put_u16(&mut exe, 0x218 + 14, 1);
        put_u32(&mut exe, 0x228, id);
        put_u32(&mut exe, 0x22C, 0x8000_0030);
        put_u16(&mut exe, 0x230 + 14, 1);
        put_u32(&mut exe, 0x240, 0x409);
        put_u32(&mut exe, 0x244, 0x48);
        put_u32(&mut exe, 0x248, 0x1058);
        put_u32(&mut exe, 0x24C, data.len() as u32);
        exe[0x258..0x258 + data.len()].copy_from_slice(data);
        exe
    }

    #[test]
    fn reads_the_resource() {
        assert_eq!(resource(&tiny_pe(1, 7, b"abc"), 1, 7), Some(&b"abc"[..]));
    }

    #[test]
    fn a_wrong_id_gives_nothing() {
        assert_eq!(resource(&tiny_pe(1, 7, b"abc"), 1, 8), None);
    }

    #[test]
    fn a_wrong_kind_gives_nothing() {
        assert_eq!(resource(&tiny_pe(1, 7, b"abc"), 12, 7), None);
    }

    #[test]
    fn a_short_buffer_gives_nothing() {
        assert_eq!(resource(&[0u8; 10], 1, 7), None);
    }
}
