//! BC4 writer of a level: the first channel of each 4 × 4 block as eight bytes (`bc5::channel_block`),
//! the level a texture's `alpha` setting asks for. A side that is not a multiple of four is padded by
//! repeating its edge, as every block family does.
use super::{bc5, blocks_of, fit, Layout};
use rayon::prelude::*;

/// The blocks of a `width` × `height` RGBA8 level, row-major, block rows in parallel on the
/// caller's pool.
pub fn encode_level(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
    let (across, down) = blocks_of(width, height);
    let row_bytes = across as usize * Layout::OneChannel.block_bytes();
    let mut out = vec![0u8; row_bytes * down as usize];
    out.par_chunks_mut(row_bytes)
        .enumerate()
        .with_min_len(8)
        .for_each(|(by, out)| {
            for (bx, out) in out.as_chunks_mut::<8>().0.iter_mut().enumerate() {
                let texels = fit::block_texels(rgba, width, height, bx as u32, by as u32);
                *out = bc5::channel_block(&texels, 0);
            }
        });
    out
}
