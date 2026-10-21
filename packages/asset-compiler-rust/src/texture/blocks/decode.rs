//! Reconstruction of what the writers emit, by the independent decoder the
//! `dds` and `ktx2` drivers already trust (`texture2ddecoder`), which shares no
//! line with them: the quality gate reads the blocks back through it, so the
//! loss it publishes is the loss a graphics card will show, never the writer's
//! own idea of it. Blocks are read one at a time, on the stack, each by its
//! format's block decoder. A two-channel level comes back with X in R and Y in G
//! whichever the family — BC5 and EAC RG11 lay them there, the luminance-alpha
//! block puts Y in A and it is moved — with Z rebuilt as the shader rebuilds it.
use super::{BlockFormat, Layout, BLOCK_BYTES};

/// Z of a unit normal from its X and Y, in bytes as the map holds them.
pub fn rebuilt_z(x: u8, y: u8) -> u8 {
    let unit = |v: u8| f32::from(v) / 127.5 - 1.0;
    let (x, y) = (unit(x), unit(y));
    let z = (1.0 - x * x - y * y).max(0.0).sqrt();
    ((z + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8
}

/// RGBA8 texels of one level's blocks, row-major, block by block (`decode_block`), or a refusal
/// on short bytes.
#[cfg(test)]
pub fn decode_level(
    blocks: &[u8],
    width: u32,
    height: u32,
    format: BlockFormat,
    layout: Layout,
) -> Result<Vec<u8>, &'static str> {
    let (width, height) = (width as usize, height as usize);
    let across = width.div_ceil(4);
    let blocks = blocks.as_chunks::<BLOCK_BYTES>().0;
    if blocks.len() < across * height.div_ceil(4) {
        return Err("truncated");
    }
    let mut rgba = vec![0u8; width * height * 4];
    for (index, block) in blocks.iter().enumerate().take(across * height.div_ceil(4)) {
        let back = decode_block(block, format, layout);
        let (bx, by) = (index % across * 4, index / across * 4);
        for texel in 0..16 {
            let (x, y) = (bx + texel % 4, by + texel / 4);
            if x < width && y < height {
                let at = (y * width + x) * 4;
                rgba[at..at + 4].copy_from_slice(&back[texel * 4..texel * 4 + 4]);
            }
        }
    }
    Ok(rgba)
}

/// The sixteen RGBA8 texels of one block, row-major, edge texels included, on the stack.
pub fn decode_block(block: &[u8; BLOCK_BYTES], format: BlockFormat, layout: Layout) -> [u8; 64] {
    use texture2ddecoder::{
        decode_astc_block, decode_bc5_block, decode_bc7_block, decode_etc2_rgba8_block,
    };
    // Each block decoder starts from the buffer the crate's level decoder hands it: opaque black,
    // ASTC's zero.
    let start = match format {
        BlockFormat::Astc => 0,
        _ => u32::from_le_bytes([0, 0, 0, 255]),
    };
    let mut words = [start; 16];
    match (format, layout) {
        (BlockFormat::Bc7, Layout::TwoChannel) => decode_bc5_block(block, &mut words),
        (BlockFormat::Bc7, Layout::Rgba) => decode_bc7_block(block, &mut words),
        (BlockFormat::Astc, _) => decode_astc_block(block, 4, 4, &mut words),
        (BlockFormat::Etc2, Layout::Rgba) => decode_etc2_rgba8_block(block, &mut words),
        (BlockFormat::Etc2, Layout::TwoChannel) => eac_rg_block(block, &mut words),
    }
    let mut rgba = [0u8; 64];
    for (texel, word) in rgba.as_chunks_mut::<4>().0.iter_mut().zip(words) {
        let [b, g, r, a] = word.to_le_bytes();
        *texel = [r, g, b, a];
        if layout == Layout::TwoChannel {
            two_channel(texel, format);
        }
    }
    rgba
}

/// A two-channel texel as the shader reads it: X in R, Y in G — moved from A out of a
/// luminance-alpha block —, Z rebuilt, opaque.
fn two_channel(texel: &mut [u8; 4], format: BlockFormat) {
    if format == BlockFormat::Astc {
        texel[1] = texel[3];
    }
    texel[2] = rebuilt_z(texel[0], texel[1]);
    texel[3] = 255;
}

/// One EAC RG11 block as BGRA words, X in R and Y in G, each half through the decoder's ETC2
/// alpha block, which shares its fields — `texture2ddecoder`'s own RG11 reader takes the index
/// bits in the wrong byte order. An R11 channel whose multiplier is not 0, the only kind `eac.rs`
/// writes, is that block's byte times eight plus four, clamped to 2047, which the card's unorm
/// read returns to the same byte: `(8b + 4) / 2047 × 255` lies within half a level of `b`.
fn eac_rg_block(block: &[u8], words: &mut [u32; 16]) {
    let [mut x, mut y] = [[0u32; 16]; 2];
    texture2ddecoder::decode_etc2_a8_block(&block[..8], &mut x);
    texture2ddecoder::decode_etc2_a8_block(&block[8..], &mut y);
    let channel = |word: &u32| word.to_le_bytes()[3];
    for (word, (x, y)) in words.iter_mut().zip(x.iter().zip(&y)) {
        *word = u32::from_le_bytes([0, channel(y), channel(x), 255]);
    }
}
