//! The DDS header and its DX10 extension, read field by field from Microsoft's public
//! specification. Offsets are those of the `DDS_HEADER` (124 bytes after the magic number),
//! `DDS_PIXELFORMAT` (32 bytes inside it) and `DDS_HEADER_DXT10` (20 more bytes) structures.
//!
//! This module reads no pixel: it returns the surface — codec, dimensions, level count and
//! level-0 offset — or a named refusal. It also checks that the announced mip chain fits in
//! the file: a DDS that promises nine levels and carries only two is truncated.
use super::codec::{self, Codec};
use super::{
    CODEC_UNSUPPORTED, DATA_TRUNCATED, HEADER_INVALID, HEADER_TRUNCATED, LAYOUT_UNSUPPORTED, MAGIC,
};
use crate::plugins::image::{Transfer, MAX_LEVELS};

/// End of `DDS_HEADER`: four magic-number bytes and one hundred and twenty-four of header.
const HEADER_END: usize = 128;
/// End of `DDS_HEADER_DXT10`, when `dwFourCC` is `DX10`.
const DX10_END: usize = HEADER_END + 20;
/// Size the two structures announce. Any other value is not a DDS we know how to read.
const HEADER_SIZE: u32 = 124;
const PIXEL_FORMAT_SIZE: u32 = 32;
/// `DDSD_PITCH`: `dwPitchOrLinearSize` then carries the line stride in bytes.
const DDSD_PITCH: u32 = 0x8;
/// `DDPF_FOURCC` and `DDPF_RGB`: the two ways `DDS_PIXELFORMAT` names its contents.
const DDPF_FOURCC: u32 = 0x4;
const DDPF_RGB: u32 = 0x40;
/// `DDSCAPS2_CUBEMAP` and `DDSCAPS2_VOLUME`: layouts this driver does not declare.
const DDSCAPS2_CUBEMAP: u32 = 0x200;
const DDSCAPS2_VOLUME: u32 = 0x0020_0000;
/// `D3D10_RESOURCE_DIMENSION_TEXTURE2D`: the only declared resource dimension.
const TEXTURE_2D: u32 = 3;
/// `DDS_RESOURCE_MISC_TEXTURECUBE`, and the `miscFlags2` alpha mask with its
/// `DDS_ALPHA_MODE_PREMULTIPLIED` value: the image contract asks for straight alpha.
const MISC_TEXTURECUBE: u32 = 0x4;
const ALPHA_MODE_MASK: u32 = 0x7;
const ALPHA_MODE_PREMULTIPLIED: u32 = 2;

/// Surface the driver will read: its codec, its size, its chain and where level 0 starts.
pub(super) struct Surface {
    pub(super) codec: Codec,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) data: usize,
    /// Transfer function the file declares. Only the DX10 header names it, through the `_SRGB`
    /// or `_UNORM` variant of its `dxgiFormat`; a legacy DDS stays silent, and convention lends
    /// it sRGB — Direct3D 9 had no sRGB format, and its colour textures carry the curve.
    pub(super) transfer: Transfer,
}

/// The thirty-two-bit word at this offset, little-endian like the whole format.
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Dimension of a mip level: each level halves and stops at one pixel.
fn level_size(size: u32, level: u32) -> u32 {
    (size >> level.min(31)).max(1)
}

pub(super) fn parse(bytes: &[u8]) -> std::result::Result<Surface, &'static str> {
    if bytes.len() < HEADER_END {
        return Err(HEADER_TRUNCATED);
    }
    if !bytes.starts_with(MAGIC) {
        return Err(HEADER_INVALID);
    }
    if word(bytes, 4) != HEADER_SIZE || word(bytes, 76) != PIXEL_FORMAT_SIZE {
        return Err(HEADER_INVALID);
    }
    let (height, width) = (word(bytes, 12), word(bytes, 16));
    let levels = word(bytes, 28).max(1);
    if width == 0 || height == 0 || levels > MAX_LEVELS {
        return Err(HEADER_INVALID);
    }
    // Depth, cube and volume: the driver only declares the single planar surface.
    if word(bytes, 24) > 1 || word(bytes, 112) & (DDSCAPS2_CUBEMAP | DDSCAPS2_VOLUME) != 0 {
        return Err(LAYOUT_UNSUPPORTED);
    }
    let flags = word(bytes, 80);
    let mut data = HEADER_END;
    let mut transfer = Transfer::Srgb;
    let codec = if flags & DDPF_FOURCC != 0 {
        let fourcc: [u8; 4] = bytes[84..88].try_into().unwrap_or([0; 4]);
        if &fourcc == b"DX10" {
            data = DX10_END;
            let (codec, declared) = dx10(bytes)?;
            transfer = declared;
            codec
        } else {
            codec::from_fourcc(fourcc).ok_or(CODEC_UNSUPPORTED)?
        }
    } else if flags & DDPF_RGB != 0 {
        let masks = [
            word(bytes, 92),
            word(bytes, 96),
            word(bytes, 100),
            word(bytes, 104),
        ];
        codec::from_masks(word(bytes, 88), masks).ok_or(CODEC_UNSUPPORTED)?
    } else {
        return Err(CODEC_UNSUPPORTED);
    };
    // A padded line stride would shift every line: refuse it instead of returning noise.
    if codec.is_uncompressed()
        && word(bytes, 8) & DDSD_PITCH != 0
        && u64::from(word(bytes, 20)) != u64::from(width) * 4
    {
        return Err(LAYOUT_UNSUPPORTED);
    }
    chain_fits(codec, width, height, levels, bytes.len() - data)?;
    Ok(Surface {
        codec,
        width,
        height,
        data,
        transfer,
    })
}

/// The DX10 header: resource dimension, array, cube and alpha mode, then the `dxgiFormat`.
fn dx10(bytes: &[u8]) -> std::result::Result<(Codec, Transfer), &'static str> {
    if bytes.len() < DX10_END {
        return Err(HEADER_TRUNCATED);
    }
    if word(bytes, 132) != TEXTURE_2D
        || word(bytes, 136) & MISC_TEXTURECUBE != 0
        || word(bytes, 140) > 1
    {
        return Err(LAYOUT_UNSUPPORTED);
    }
    if word(bytes, 144) & ALPHA_MODE_MASK == ALPHA_MODE_PREMULTIPLIED {
        return Err(CODEC_UNSUPPORTED);
    }
    codec::from_dxgi(word(bytes, 128)).ok_or(CODEC_UNSUPPORTED)
}

/// The announced chain must fit in what remains of the file. That is the only use of the level
/// count: only level 0 is read, but it is refused in a file that is lying.
fn chain_fits(
    codec: Codec,
    width: u32,
    height: u32,
    levels: u32,
    available: usize,
) -> std::result::Result<(), &'static str> {
    let needed = (0..levels)
        .map(|level| codec.level_bytes(level_size(width, level), level_size(height, level)))
        .fold(0u64, u64::saturating_add);
    if needed <= available as u64 {
        Ok(())
    } else {
        Err(DATA_TRUNCATED)
    }
}
