//! The eight-bit writer of a level: one channel of each 4 × 4 block kept to the bit, the sixteen
//! texels row by row in sixteen bytes — no codec, the level files' deflate does the squeezing. The
//! level a texture's `grayscale` setting (the red channel) or `displacementmap` setting (the alpha
//! channel) asks for: a map that must not lose a bit. A side that is not a multiple of four is
//! padded by repeating its edge, as every block family does.
use super::{fit, Layout};

/// The blocks of a `width` × `height` RGBA8 level holding `channel` (0 red … 3 alpha), row-major,
/// block rows in parallel on the caller's pool.
pub fn encode_level(rgba: &[u8], width: u32, height: u32, channel: usize) -> Vec<u8> {
    fit::encode_blocks(
        rgba,
        (width, height),
        Layout::Gray.block_bytes(),
        |texels, out| {
            for (byte, texel) in out.iter_mut().zip(texels) {
                *byte = texel[channel] as u8;
            }
        },
    )
}
