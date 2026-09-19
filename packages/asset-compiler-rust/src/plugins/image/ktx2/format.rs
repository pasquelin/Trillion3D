//! `vkFormat` values the `ktx2` driver declares, one by one, and nothing else.
//!
//! A KTX 2.0 names its codec by Vulkan's `VkFormat` value, except when it carries a Basis
//! Universal payload: it then writes `VK_FORMAT_UNDEFINED` and lets its format descriptor say
//! what it contains. The numbers below are those of the Vulkan registry, cited in comments;
//! anything not on the list returns `None`, and it is the caller that turns that into a named
//! refusal.
//!
//! Off the list, on purpose: signed variants (BC4, BC5, EAC), BC6H and its floats, every
//! `VkFormat` of more than eight bits per channel, byte orders other than R, G, B, A, and the
//! thirteen ASTC footprints other than 4 × 4 — the four-line-row reconstruction of
//! `image::blocks` only knows how to walk four-pixel-high blocks.
//! The two unsigned EAC formats are an exception: they are expanded by `super::eac`, written
//! here. The external decoder brought them back to eight bits by truncation and read their
//! index field backwards; the neighbouring module says which of the two defects does what.
use super::eac;
use crate::plugins::image::blocks::BlockDecode;
use crate::plugins::image::Transfer;
use texture2ddecoder::{
    decode_astc, decode_bc1, decode_bc1a, decode_bc2, decode_bc3, decode_bc4, decode_bc5,
    decode_bc7, decode_etc2_rgb, decode_etc2_rgba1, decode_etc2_rgba8,
};

/// `VK_FORMAT_UNDEFINED`: the container carries a Basis Universal payload.
pub(super) const UNDEFINED: u32 = 0;

/// How a level's bytes become pixels. This is a codec's only description: a level's weight
/// and its reconstruction both derive from it.
pub(super) enum Layout {
    /// 4 × 4 texel blocks: a block's bytes and the decoder that expands them.
    Blocks { bytes: usize, decode: BlockDecode },
    /// Uncompressed, four bytes per texel, already in the contract's R, G, B, A order.
    Rgba8,
}

impl Layout {
    /// Bytes occupied by a level of this size. Blocks always cover multiples of four texels:
    /// a 1 × 1 level still weighs a whole block. The count saturates rather than overflowing:
    /// absurd dimensions give an absurd need, hence a refusal.
    pub(super) fn level_bytes(&self, width: u32, height: u32) -> u64 {
        match self {
            Layout::Blocks { bytes, .. } => u64::from(width.div_ceil(4))
                .saturating_mul(u64::from(height.div_ceil(4)))
                .saturating_mul(*bytes as u64),
            Layout::Rgba8 => u64::from(width)
                .saturating_mul(u64::from(height))
                .saturating_mul(4),
        }
    }
}

/// `vkFormat` values that the Vulkan registry names `_SRGB`. They carry exactly the same
/// bytes as their `_UNORM` twins, which immediately follow or precede them in `layout` —
/// that is the only thing that separates them, and it changes the reading of the whole
/// texture.
const SRGB: &[u32] = &[43, 132, 134, 136, 138, 146, 148, 150, 152, 158];

/// Transfer function that this `vkFormat` **names**, when it names one. `VK_FORMAT_UNDEFINED`
/// — the container then carries a Basis Universal payload — names none: it is its format
/// descriptor that speaks, and failing that the convention.
pub(super) fn transfer(format: u32) -> Option<Transfer> {
    if SRGB.contains(&format) {
        return Some(Transfer::Srgb);
    }
    layout(format).map(|_| Transfer::Linear)
}

/// Layout of this `vkFormat`: the only table that links a declared format to its bytes. The
/// `_SRGB` variants carry the same bytes as their `_UNORM`; `SRGB` says which.
pub(super) fn layout(format: u32) -> Option<Layout> {
    let blocks = |bytes, decode: BlockDecode| Layout::Blocks { bytes, decode };
    Some(match format {
        // R8G8B8A8_UNORM, R8G8B8A8_SRGB
        37 | 43 => Layout::Rgba8,
        // BC1_RGB_UNORM_BLOCK, BC1_RGB_SRGB_BLOCK: the block's alpha bit only encodes a black,
        // the surface is opaque.
        131 | 132 => blocks(8, decode_bc1),
        // BC1_RGBA_UNORM_BLOCK, BC1_RGBA_SRGB_BLOCK: the same block, one-bit alpha honoured.
        133 | 134 => blocks(8, decode_bc1a),
        // BC2_UNORM_BLOCK, BC2_SRGB_BLOCK
        135 | 136 => blocks(16, decode_bc2),
        // BC3_UNORM_BLOCK, BC3_SRGB_BLOCK
        137 | 138 => blocks(16, decode_bc3),
        // BC4_UNORM_BLOCK
        139 => blocks(8, decode_bc4),
        // BC5_UNORM_BLOCK
        141 => blocks(16, decode_bc5),
        // BC7_UNORM_BLOCK, BC7_SRGB_BLOCK
        145 | 146 => blocks(16, decode_bc7),
        // ETC2_R8G8B8_UNORM_BLOCK, ETC2_R8G8B8_SRGB_BLOCK
        147 | 148 => blocks(8, decode_etc2_rgb),
        // ETC2_R8G8B8A1_UNORM_BLOCK, ETC2_R8G8B8A1_SRGB_BLOCK
        149 | 150 => blocks(8, decode_etc2_rgba1),
        // ETC2_R8G8B8A8_UNORM_BLOCK, ETC2_R8G8B8A8_SRGB_BLOCK
        151 | 152 => blocks(16, decode_etc2_rgba8),
        // EAC_R11_UNORM_BLOCK
        153 => blocks(8, eac::r11),
        // EAC_R11G11_UNORM_BLOCK
        155 => blocks(16, eac::rg11),
        // ASTC_4x4_UNORM_BLOCK, ASTC_4x4_SRGB_BLOCK
        157 | 158 => blocks(16, astc_4x4),
        _ => return None,
    })
}

/// ASTC is not named by a function of the expected form: its decoder also receives the block
/// geometry, which the format has not fixed. This short relay fixes it at 4 × 4, the only
/// declared footprint.
fn astc_4x4(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    decode_astc(level, width, height, 4, 4, image)
}
