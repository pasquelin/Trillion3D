//! The exact writer of a float level: the texels of each 4 × 4 square kept as they are, row by row,
//! `texel_bytes` each — the "blocks" of the float layouts (`Layout::Float32`, `SingleFloat`,
//! `HalfSingle`), so a level file is cut and read as every block family's. A side that is not a
//! multiple of four is padded by repeating its edge.
use super::blocks_of;
use rayon::prelude::*;

/// The blocks of a `width` × `height` level of `texel_bytes`-byte texels, row-major, block rows in
/// parallel on the caller's pool.
pub fn encode_texels(texels: &[u8], width: u32, height: u32, texel_bytes: usize) -> Vec<u8> {
    debug_assert_eq!(texels.len(), width as usize * height as usize * texel_bytes);
    let (across, down) = blocks_of(width, height);
    let block = 16 * texel_bytes;
    let row_bytes = across as usize * block;
    let mut out = vec![0u8; row_bytes * down as usize];
    out.par_chunks_mut(row_bytes)
        .enumerate()
        .for_each(|(by, row)| {
            for (bx, block) in row.chunks_exact_mut(block).enumerate() {
                for t in 0..16usize {
                    let x = (bx * 4 + t % 4).min(width as usize - 1);
                    let y = (by * 4 + t / 4).min(height as usize - 1);
                    let from = (y * width as usize + x) * texel_bytes;
                    block[t * texel_bytes..(t + 1) * texel_bytes]
                        .copy_from_slice(&texels[from..from + texel_bytes]);
                }
            }
        });
    out
}
