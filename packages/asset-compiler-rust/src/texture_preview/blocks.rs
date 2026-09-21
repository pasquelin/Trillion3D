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
mod measure;
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
}

/// A level in every block format, `BlockFormat::ALL` order.
pub type Levels = [Vec<u8>; 2];

/// Blocks across and down a `width` × `height` level.
pub fn blocks_of(width: u32, height: u32) -> (u32, u32) {
    (width.div_ceil(4), height.div_ceil(4))
}

/// Compressed bytes of a `width` × `height` level.
pub fn level_block_bytes(width: u32, height: u32) -> usize {
    let (across, down) = blocks_of(width, height);
    across as usize * down as usize * BLOCK_BYTES
}

/// Compresses one RGBA8 level in both formats at once: a block is read and its
/// principal segment found once, then each codec fits its own ladder on it.
/// Blocks are written in place, block rows in parallel.
pub fn encode_level(rgba: &[u8], width: u32, height: u32) -> Levels {
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let (across, down) = blocks_of(width, height);
    let row_bytes = across as usize * BLOCK_BYTES;
    let mut bc7 = vec![0u8; row_bytes * down as usize];
    let mut astc = vec![0u8; row_bytes * down as usize];
    let row = |by: usize, bc7: &mut [u8], astc: &mut [u8]| {
        for bx in 0..across as usize {
            let texels = fit::block_texels(rgba, width, height, bx as u32, by as u32);
            let segment = fit::segment(&texels);
            let at = bx * BLOCK_BYTES..(bx + 1) * BLOCK_BYTES;
            bc7[at.clone()].copy_from_slice(&bc7::encode(&texels, segment));
            astc[at].copy_from_slice(&astc::encode(&texels, segment));
        }
    };
    let rows = bc7.chunks_mut(row_bytes).zip(astc.chunks_mut(row_bytes));
    // A small level — the tail, a thumbnail — is not worth the pool; a large one
    // splits by block row, each row independent of the others.
    if down < 8 {
        rows.enumerate().for_each(|(by, (b, a))| row(by, b, a));
    } else {
        rows.enumerate()
            .par_bridge()
            .for_each(|(by, (b, a))| row(by, b, a));
    }
    [bc7, astc]
}
