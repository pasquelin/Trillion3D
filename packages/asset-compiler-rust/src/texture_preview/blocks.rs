//! Block compression of a baked level, at cook time: BC7 for the desktop
//! graphics cards and ASTC 4 × 4 for the mobile ones, one byte per texel either
//! way against four for RGBA8. Both are lossy; the loss is a declared pixel
//! cost, measured on real scenes, never hidden by the engine. Every level of a
//! chain is written in both, and the sidecar tail too, so one cache serves
//! every device and the browser chooses by what its device supports.
//!
//! A level is cut into 4 × 4 blocks, row-major, sixteen bytes each; a side that
//! is not a multiple of four is padded by repeating its edge, and the padded
//! blocks are part of the level's bytes — WebGPU copies whole blocks.
use rayon::prelude::*;

mod astc;
mod bc7;
mod fit;
mod ise;
#[cfg(test)]
mod tests;

/// Bytes of one compressed block, in both formats.
pub const BLOCK_BYTES: usize = 16;

/// The two formats written, in the order the sidecar columns carry them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlockFormat {
    Bc7,
    Astc,
}
impl BlockFormat {
    pub const ALL: [BlockFormat; 2] = [BlockFormat::Bc7, BlockFormat::Astc];
    /// The file extension of a baked level, and the name the manifest uses.
    pub fn name(self) -> &'static str {
        match self {
            Self::Bc7 => "bc7",
            Self::Astc => "astc",
        }
    }
    pub fn index(self) -> usize {
        match self {
            Self::Bc7 => 0,
            Self::Astc => 1,
        }
    }
}

/// Blocks across and down a `width` × `height` level.
pub fn blocks_of(width: u32, height: u32) -> (u32, u32) {
    (width.div_ceil(4), height.div_ceil(4))
}

/// Compressed bytes of a `width` × `height` level.
pub fn level_block_bytes(width: u32, height: u32) -> usize {
    let (across, down) = blocks_of(width, height);
    across as usize * down as usize * BLOCK_BYTES
}

/// Compresses one RGBA8 level, block rows in parallel.
pub fn encode_level(rgba: &[u8], width: u32, height: u32, format: BlockFormat) -> Vec<u8> {
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let (across, down) = blocks_of(width, height);
    let encode = match format {
        BlockFormat::Bc7 => bc7::encode,
        BlockFormat::Astc => astc::encode,
    };
    let row = |by: u32| -> Vec<u8> {
        let mut out = Vec::with_capacity(across as usize * BLOCK_BYTES);
        for bx in 0..across {
            out.extend_from_slice(&encode(&fit::block_texels(rgba, width, height, bx, by)));
        }
        out
    };
    // A small level — the tail, a thumbnail — is not worth the pool; a large one
    // splits by block row, each row independent of the others.
    if down < 8 {
        (0..down).flat_map(row).collect()
    } else {
        (0..down).into_par_iter().map(row).flatten().collect()
    }
}
