//! BC4 writer of a level: the first channel of each 4 × 4 block as eight bytes (`bc5::channel_block`),
//! the level a texture's `alpha` setting asks for. A side that is not a multiple of four is padded by
//! repeating its edge, as every block family does.
use super::{bc5, fit, Layout};

/// The blocks of a `width` × `height` RGBA8 level, row-major, block rows in parallel on the
/// caller's pool.
pub fn encode_level(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    fit::encode_blocks(
        rgba,
        (width, height),
        Layout::OneChannel.block_bytes(),
        |texels, out| out.copy_from_slice(&bc5::channel_block(texels, 0)),
    )
}
