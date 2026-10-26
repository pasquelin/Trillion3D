//! The eight-bit writer of a level: one channel of each 4 × 4 block kept to the bit, the sixteen
//! texels row by row in sixteen bytes — no codec, the level files' deflate does the squeezing. The
//! level a texture's `grayscale` setting (the red channel) or `displacementmap` setting (the alpha
//! channel) asks for: a map that must not lose a bit. A side that is not a multiple of four is
//! padded by repeating its edge, as every block family does.
use super::{blocks_of, fit, Layout};
use rayon::prelude::*;

/// The blocks of a `width` × `height` RGBA8 level holding `channel` (0 red … 3 alpha), row-major,
/// block rows in parallel on the caller's pool.
pub fn encode_level(rgba: &[u8], width: u32, height: u32, channel: usize) -> Vec<u8> {
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let (across, down) = blocks_of(width, height);
    let block = Layout::Gray.block_bytes();
    let row_bytes = across as usize * block;
    let mut out = vec![0u8; row_bytes * down as usize];
    out.par_chunks_mut(row_bytes)
        .enumerate()
        .with_min_len(8)
        .for_each(|(by, out)| {
            for (bx, out) in out.chunks_exact_mut(block).enumerate() {
                let texels = fit::block_texels(rgba, width, height, bx as u32, by as u32);
                for (byte, texel) in out.iter_mut().zip(texels) {
                    *byte = texel[channel] as u8;
                }
            }
        });
    out
}
