//! The KTX 2.0 header and its level index, read field by field from Khronos's public
//! specification. Offsets are those of the document's structure: twelve identifier bytes,
//! then `vkFormat`, `typeSize`, the three dimensions, `layerCount`, `faceCount`, `levelCount`
//! and `supercompressionScheme`, then the index of the three sections, then the level index.
//!
//! This module reads no pixel: it returns the surface — codec, dimensions, supercompression
//! scheme and level-0 bounds — or a named refusal. The announced chain is checked whole: a
//! KTX2 that promises nine levels of which one falls outside the file is truncated, not
//! half-good.
use super::{dfd, format};
use super::{
    DATA_TRUNCATED, HEADER_INVALID, HEADER_TRUNCATED, LAYOUT_UNSUPPORTED, MAGIC,
    SUPERCOMPRESSION_UNSUPPORTED,
};
use crate::plugins::image::{Transfer, MAX_LEVELS};

/// End of the fixed header: identifier, fourteen fields and the index of the three sections.
const HEADER_END: usize = 80;
/// One level-index entry: offset, length, length once decompressed.
const LEVEL_ENTRY: usize = 24;
/// `typeSize` is one for every block-compressed format as for the uncompressed byte; another
/// value announces multi-byte words to reorder, off the declared list.
const TYPE_SIZE: u32 = 1;

/// `supercompressionScheme`: the three schemes this driver declares, of the four numbered.
/// ZLIB (3) does not enter — no current encoder writes it, and an unexercised reader lies.
const NONE: u32 = 0;
const BASIS_LZ: u32 = 1;
pub(super) const ZSTD: u32 = 2;

/// Surface the driver will read: its codec, its size, its supercompression and its level 0.
pub(super) struct Surface {
    pub(super) format: u32,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) supercompression: u32,
    /// Transfer function the file declares: that of the format descriptor when it names one,
    /// that of the `vkFormat` otherwise, and failing that conventional sRGB.
    pub(super) transfer: Transfer,
    /// The format descriptor raises the premultiplied-alpha flag: components are already
    /// multiplied by their alpha, and the output contract asks for them straight.
    pub(super) premultiplied: bool,
    /// Level-0 bounds in the file, as the index gives them.
    pub(super) level: std::ops::Range<usize>,
    /// `uncompressedByteLength` of level 0: what supercompression must return.
    pub(super) plain: usize,
}

/// The thirty-two-bit word at this offset, little-endian like the whole format.
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// The sixty-four-bit word at this offset: the level index only counts in 64 bits.
fn long(bytes: &[u8], at: usize) -> std::result::Result<usize, &'static str> {
    let long = u64::from_le_bytes(bytes[at..at + 8].try_into().map_err(|_| DATA_TRUNCATED)?);
    usize::try_from(long).map_err(|_| DATA_TRUNCATED)
}

pub(super) fn parse(bytes: &[u8]) -> std::result::Result<Surface, &'static str> {
    if bytes.len() < HEADER_END {
        return Err(HEADER_TRUNCATED);
    }
    if !bytes.starts_with(MAGIC) {
        return Err(HEADER_INVALID);
    }
    let format = word(bytes, 12);
    let (width, height, depth) = (word(bytes, 20), word(bytes, 24), word(bytes, 28));
    let (layers, faces, levels) = (word(bytes, 32), word(bytes, 36), word(bytes, 40));
    let supercompression = word(bytes, 44);
    if width == 0 || word(bytes, 16) != TYPE_SIZE || levels > MAX_LEVELS {
        return Err(HEADER_INVALID);
    }
    // Null height (one-dimensional texture), volume, layer array and cube: the driver only
    // declares the single planar surface.
    if height == 0 || depth > 0 || layers > 1 || faces != 1 {
        return Err(LAYOUT_UNSUPPORTED);
    }
    if !matches!(supercompression, NONE | BASIS_LZ | ZSTD) {
        return Err(SUPERCOMPRESSION_UNSUPPORTED);
    }
    // A null `levelCount` announces a texture whose levels are computed at load: a single
    // level is stored, and that is the one that is read.
    let levels = levels.max(1) as usize;
    let (level, plain) = chain(bytes, levels)?;
    let descriptor = dfd::read(bytes);
    let transfer = descriptor
        .transfer
        .or_else(|| format::transfer(format))
        .unwrap_or(Transfer::Srgb);
    Ok(Surface {
        format,
        width,
        height,
        supercompression,
        level,
        plain,
        transfer,
        premultiplied: descriptor.premultiplied,
    })
}

/// The level index, whole. Each announced level must fit in the file and start after the
/// index itself; only level 0 is read, but it is refused in a file that is lying.
fn chain(
    bytes: &[u8],
    levels: usize,
) -> std::result::Result<(std::ops::Range<usize>, usize), &'static str> {
    let index = HEADER_END + levels * LEVEL_ENTRY;
    if bytes.len() < index {
        return Err(HEADER_TRUNCATED);
    }
    let mut base = (0..0, 0);
    for level in 0..levels {
        let at = HEADER_END + level * LEVEL_ENTRY;
        let offset = long(bytes, at)?;
        let end = offset
            .checked_add(long(bytes, at + 8)?)
            .ok_or(DATA_TRUNCATED)?;
        if offset < index {
            return Err(HEADER_INVALID);
        }
        if end > bytes.len() {
            return Err(DATA_TRUNCATED);
        }
        if level == 0 {
            base = (offset..end, long(bytes, at + 16)?);
        }
    }
    Ok(base)
}
