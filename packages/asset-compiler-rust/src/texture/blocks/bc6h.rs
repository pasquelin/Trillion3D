//! BC6H writer of a half-float level: unsigned half-float RGB in sixteen-byte blocks, searched by
//! `block_compression` (`BC6HSettings::basic`, the quality the format's reference encoder cooks a compressed half-float texture at). The codec has
//! no alpha and no sign: alpha is dropped and a negative value reads as zero, which is what a
//! texture the `hdrCompressed` setting names accepts. A side that is not a multiple of four is
//! padded by repeating its edge, as every block family does.
use super::{blocks_of, BLOCK_BYTES};
use block_compression::{encode::compress_rgba16, BC6HSettings, CompressionVariant};
use half::f16;
use rayon::prelude::*;

/// The blocks of a `width` × `height` level of half-float RGBA texels, `level` their little-endian
/// bytes (`hdr::chain`'s), row-major: block rows in parallel on the caller's pool.
pub fn encode_level(level: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (across, down) = blocks_of(width, height);
    let padded = (across as usize * 4, down as usize * 4);
    let (width, height) = (width as usize, height as usize);
    let texel = |x: usize, y: usize, channel: usize| {
        let at = ((y.min(height - 1) * width + x.min(width - 1)) * 4 + channel) * 2;
        let value = f16::from_bits(u16::from_le_bytes([level[at], level[at + 1]]));
        // The format holds no sign: a negative value, a negative zero and a NaN read as zero.
        if value.is_sign_negative() || value.is_nan() {
            f16::ZERO
        } else {
            value
        }
    };
    let row_bytes = across as usize * BLOCK_BYTES;
    let mut out = vec![0u8; row_bytes * down as usize];
    out.par_chunks_mut(row_bytes)
        .enumerate()
        .for_each(|(by, row)| {
            // One block row at a time: its four texel rows, padded to whole blocks.
            let mut texels = Vec::with_capacity(padded.0 * 4 * 4);
            for y in by * 4..by * 4 + 4 {
                for x in 0..padded.0 {
                    texels.extend((0..4).map(|channel| texel(x, y, channel)));
                }
            }
            compress_rgba16(
                CompressionVariant::BC6H(BC6HSettings::basic()),
                &texels,
                row,
                padded.0 as u32,
                4,
                padded.0 as u32 * 4,
            );
        });
    out
}
