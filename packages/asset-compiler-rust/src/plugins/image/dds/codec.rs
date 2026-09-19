//! Codecs the `dds` driver declares, one by one, and nothing else.
//!
//! A DDS names its codec in three ways, all documented by Microsoft: the Direct3D 9-era
//! `dwFourCC`, the DX10 header's `dxgiFormat`, or — for an uncompressed surface — its bit
//! masks. All three paths arrive here and return `None` for anything not on the list: it is
//! the caller that turns that into a named refusal.
use crate::plugins::image::blocks::BlockDecode;
use crate::plugins::image::Transfer;
use texture2ddecoder::{decode_bc1a, decode_bc2, decode_bc3, decode_bc4, decode_bc5, decode_bc7};

/// Declared codecs. Nothing here is "guessed": each variant was registered on purpose, with
/// the format identifiers that lead to it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Codec {
    /// BC1 (`DXT1`): interpolated 565 colours, one-bit alpha.
    Bc1,
    /// BC2 (`DXT3`): BC1 colours and explicit four-bit alpha.
    Bc2,
    /// BC3 (`DXT5`): BC1 colours and interpolated three-bit alpha.
    Bc3,
    /// BC4: a single interpolated channel, returned as red.
    Bc4,
    /// BC5: two interpolated channels, returned as red and green — tangent-space normals.
    Bc5,
    /// BC7: the eight partitioning modes, colour and alpha together.
    Bc7,
    /// Uncompressed, bytes in R, G, B, A order.
    Rgba8,
    /// Uncompressed, bytes in B, G, R, A order — Direct3D 9's native order.
    Bgra8,
    /// Uncompressed, bytes B, G, R then an ignored byte: the surface is opaque.
    Bgrx8,
}

/// How a level's bytes become pixels. This is a codec's only description: a level's weight,
/// its read and its reconstruction all derive from it.
#[derive(Clone, Copy)]
pub(super) enum Layout {
    /// 4 × 4 pixel blocks: a block's bytes and the decoder that expands them.
    Blocks { bytes: u8, decode: BlockDecode },
    /// An uncompressed surface, four bytes per pixel in the named order.
    Pixels(Order),
}

/// Order of the four bytes of an uncompressed pixel.
#[derive(Clone, Copy)]
pub(super) enum Order {
    /// R, G, B, A: already the contract order.
    Rgba,
    /// B, G, R, A.
    Bgra,
    /// B, G, R then a byte ignored by the specification: the surface is opaque.
    Bgrx,
}

impl Codec {
    /// This codec's layout: the only table that links a declared codec to its bytes.
    pub(super) fn layout(self) -> Layout {
        let blocks = |bytes, decode: BlockDecode| Layout::Blocks { bytes, decode };
        match self {
            Codec::Bc1 => blocks(8, decode_bc1a),
            Codec::Bc2 => blocks(16, decode_bc2),
            Codec::Bc3 => blocks(16, decode_bc3),
            Codec::Bc4 => blocks(8, decode_bc4),
            Codec::Bc5 => blocks(16, decode_bc5),
            Codec::Bc7 => blocks(16, decode_bc7),
            Codec::Rgba8 => Layout::Pixels(Order::Rgba),
            Codec::Bgra8 => Layout::Pixels(Order::Bgra),
            Codec::Bgrx8 => Layout::Pixels(Order::Bgrx),
        }
    }

    /// An uncompressed surface is read line by line, four bytes per pixel.
    pub(super) fn is_uncompressed(self) -> bool {
        matches!(self.layout(), Layout::Pixels(_))
    }

    /// Bytes occupied by a level of this size. Blocks always cover multiples of four pixels:
    /// a 1 × 1 level still weighs a whole block. The count saturates rather than overflowing:
    /// absurd dimensions give an absurd need, hence a refusal.
    pub(super) fn level_bytes(self, width: u32, height: u32) -> u64 {
        match self.layout() {
            Layout::Blocks { bytes, .. } => u64::from(width.div_ceil(4))
                .saturating_mul(u64::from(height.div_ceil(4)))
                .saturating_mul(u64::from(bytes)),
            Layout::Pixels(_) => u64::from(width)
                .saturating_mul(u64::from(height))
                .saturating_mul(4),
        }
    }
}

/// Codec of a Direct3D 9 `dwFourCC`. `DXT2` and `DXT4` carry the same blocks as `DXT3` and
/// `DXT5` but a premultiplied alpha: the image contract asks for straight alpha, so they are
/// refused rather than returned wrong. `BC4S` and `BC5S` are signed, also off the list.
///
/// None of these names declares a transfer function: Direct3D 9 had no sRGB format.
/// It is the caller that then lends the conventional sRGB to the surface.
pub(super) fn from_fourcc(fourcc: [u8; 4]) -> Option<Codec> {
    Some(match &fourcc {
        b"DXT1" => Codec::Bc1,
        b"DXT3" => Codec::Bc2,
        b"DXT5" => Codec::Bc3,
        b"ATI1" | b"BC4U" => Codec::Bc4,
        b"ATI2" | b"BC5U" => Codec::Bc5,
        _ => return None,
    })
}

/// `dxgiFormat` values that the `DXGI_FORMAT` registry names `_SRGB`. They carry exactly the
/// same bytes as their `_UNORM` twins, which immediately precede them in the registry.
const SRGB: &[u32] = &[29, 72, 75, 78, 91, 93, 99];

/// Codec of a DX10-header `dxgiFormat` and the transfer function that name **declares**,
/// by the `DXGI_FORMAT` enumeration values. An `_SRGB` variant carries exactly the same bytes
/// as its `_UNORM` and does not mean the same thing: one announces samples proportional to
/// light, the other bytes encoded by the sRGB curve. `_TYPELESS` do not declare their
/// interpretation; signed, float (BC6H), 16-bit and YUV fall off the list.
pub(super) fn from_dxgi(format: u32) -> Option<(Codec, Transfer)> {
    let codec = match format {
        // R8G8B8A8_UNORM, R8G8B8A8_UNORM_SRGB
        28 | 29 => Codec::Rgba8,
        // BC1_UNORM, BC1_UNORM_SRGB
        71 | 72 => Codec::Bc1,
        // BC2_UNORM, BC2_UNORM_SRGB
        74 | 75 => Codec::Bc2,
        // BC3_UNORM, BC3_UNORM_SRGB
        77 | 78 => Codec::Bc3,
        // BC4_UNORM, BC5_UNORM: one and two interpolated channels, no sRGB variant in the registry.
        80 => Codec::Bc4,
        83 => Codec::Bc5,
        // B8G8R8A8_UNORM, B8G8R8A8_UNORM_SRGB
        87 | 91 => Codec::Bgra8,
        // B8G8R8X8_UNORM, B8G8R8X8_UNORM_SRGB
        88 | 93 => Codec::Bgrx8,
        // BC7_UNORM, BC7_UNORM_SRGB
        98 | 99 => Codec::Bc7,
        _ => return None,
    };
    let transfer = match SRGB.contains(&format) {
        true => Transfer::Srgb,
        false => Transfer::Linear,
    };
    Some((codec, transfer))
}

/// Codec of an uncompressed surface, from its `dwRBitMask`, `dwGBitMask`, `dwBBitMask` and
/// `dwABitMask` masks. Only the three declared thirty-two-bit profiles are read: an unexpected
/// mask — 16-bit, 24-bit, shifted channels — is off the list.
pub(super) fn from_masks(bit_count: u32, masks: [u32; 4]) -> Option<Codec> {
    if bit_count != 32 {
        return None;
    }
    Some(match masks {
        [0x0000_00ff, 0x0000_ff00, 0x00ff_0000, 0xff00_0000] => Codec::Rgba8,
        [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0xff00_0000] => Codec::Bgra8,
        [0x00ff_0000, 0x0000_ff00, 0x0000_00ff, 0] => Codec::Bgrx8,
        _ => return None,
    })
}
