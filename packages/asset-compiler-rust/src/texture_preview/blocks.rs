//! Block compression of a baked level, at cook time: the BC family for the
//! desktop graphics cards, ASTC 4 × 4 for the mobile ones, one byte per texel
//! either way against four for RGBA8. Both are lossy, and a lossy texel is a
//! visible one: every chain is read back through an independent decoder and
//! measured against its source (`quality.rs`), and a chain under the bar stays
//! lossless. What the sidecar and the level files carry is what the gate kept.
//!
//! A family writes two layouts: RGBA (BC7 mode 6, ASTC colour endpoint mode
//! 12) for colour and smooth data maps, and TWO CHANNELS (BC5, ASTC luminance
//! and alpha on two weight planes) for a normal map, whose X and Y vary in
//! directions of their own that one RGBA segment cannot hold; the shader
//! rebuilds Z. A level is cut into 4 × 4 blocks, row-major, sixteen bytes each;
//! a side that is not a multiple of four is padded by repeating its edge, and
//! the padded blocks are part of the level's bytes — WebGPU copies whole blocks.
use rayon::prelude::*;

mod astc;
mod astc_la;
mod bc5;
mod bc7;
mod channel;
pub mod decode;
mod fit;
mod ise;
pub mod quality;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_two_channel;

/// Bytes of one compressed block, in every format.
pub const BLOCK_BYTES: usize = 16;

/// The two families a cook can write, in the order the sidecar columns carry
/// them. A family is named by its RGBA codec — `bc7`, `astc` — on the command
/// line, in the manifest and in the engine's choice.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlockFormat {
    Bc7,
    Astc,
}
impl BlockFormat {
    pub const ALL: [BlockFormat; 2] = [BlockFormat::Bc7, BlockFormat::Astc];
    pub fn name(self) -> &'static str {
        match self {
            Self::Bc7 => "bc7",
            Self::Astc => "astc",
        }
    }
    pub fn named(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|format| format.name() == name)
    }
    /// Rank in `ALL`: the family's column, layout word and tail slot.
    pub fn index(self) -> usize {
        self as usize
    }
    /// The file extension of a level in `layout`, and the name the manifest
    /// template takes. The layout is in the name: a file already there is never
    /// rewritten, and an ASTC block says its own layout only once decoded.
    pub fn file_name(self, layout: Layout) -> &'static str {
        match (self, layout) {
            (Self::Bc7, Layout::Rgba) => "bc7",
            (Self::Bc7, Layout::TwoChannel) => "bc5",
            (Self::Astc, Layout::Rgba) => "astc",
            (Self::Astc, Layout::TwoChannel) => "astc-la",
        }
    }
}

/// How a chain's texels are laid out in a family's blocks. What a sidecar
/// entry says of each family is `Option<Layout>`: `None` is a lossless chain,
/// no blocks written.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layout {
    Rgba,
    TwoChannel,
}
impl Layout {
    pub fn name(self) -> &'static str {
        match self {
            Self::Rgba => "rgba",
            Self::TwoChannel => "two-channel",
        }
    }
    /// The word a sidecar entry carries: 0 lossless, then the layouts.
    pub fn word(layout: Option<Layout>) -> u32 {
        match layout {
            None => 0,
            Some(Self::Rgba) => 1,
            Some(Self::TwoChannel) => 2,
        }
    }
    /// The inverse: `Some(layout or lossless)`, `None` for a word no layout owns.
    pub fn from_word(word: u32) -> Option<Option<Layout>> {
        match word {
            0 => Some(None),
            1 => Some(Some(Self::Rgba)),
            2 => Some(Some(Self::TwoChannel)),
            _ => None,
        }
    }
}

/// Texels along a block's side.
pub const BLOCK_SIDE: u32 = 4;

/// Blocks across and down a `width` × `height` level.
fn blocks_of(width: u32, height: u32) -> (u32, u32) {
    (width.div_ceil(BLOCK_SIDE), height.div_ceil(BLOCK_SIDE))
}

/// Compressed bytes of a `width` × `height` level.
pub fn level_block_bytes(width: u32, height: u32) -> usize {
    let (across, down) = blocks_of(width, height);
    across as usize * down as usize * BLOCK_BYTES
}

/// Compresses one RGBA8 level in one family and layout. Blocks are written in
/// place, block rows in parallel on the caller's pool.
pub fn encode_level(
    rgba: &[u8],
    width: u32,
    height: u32,
    format: BlockFormat,
    layout: Layout,
) -> Vec<u8> {
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let (across, down) = blocks_of(width, height);
    let row_bytes = across as usize * BLOCK_BYTES;
    let mut out = vec![0u8; row_bytes * down as usize];
    let block = |texels: &fit::Texels| -> [u8; 16] {
        match (format, layout) {
            (BlockFormat::Bc7, Layout::Rgba) => bc7::encode(texels, fit::segment(texels)),
            (BlockFormat::Astc, Layout::Rgba) => astc::encode(texels, fit::segment(texels)),
            (BlockFormat::Bc7, Layout::TwoChannel) => bc5::encode(texels),
            (BlockFormat::Astc, Layout::TwoChannel) => astc_la::encode(texels),
        }
    };
    let row = |by: usize, out: &mut [u8]| {
        for bx in 0..across as usize {
            let texels = fit::block_texels(rgba, width, height, bx as u32, by as u32);
            out[bx * BLOCK_BYTES..(bx + 1) * BLOCK_BYTES].copy_from_slice(&block(&texels));
        }
    };
    let rows = out.chunks_mut(row_bytes).enumerate();
    // A small level — the tail, a thumbnail — is not worth the pool; a large one
    // splits by block row, each row independent of the others.
    if down < 8 {
        rows.for_each(|(by, out)| row(by, out));
    } else {
        rows.par_bridge().for_each(|(by, out)| row(by, out));
    }
    out
}
