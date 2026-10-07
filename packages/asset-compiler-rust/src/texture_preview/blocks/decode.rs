//! Reconstruction of what the writers emit, by the independent decoder the
//! `dds` and `ktx2` drivers already trust (`texture2ddecoder`), which shares no
//! line with them: the quality gate reads the blocks back through it, so the
//! loss it publishes is the loss a graphics card will show, never the writer's
//! own idea of it. A two-channel level comes back with X in R and Y in G
//! whichever the family — BC5 and EAC RG11 lay them there, the luminance-alpha
//! block puts Y in A and it is moved — with Z rebuilt as the shader rebuilds it.
use super::{BlockFormat, Layout, BLOCK_BYTES};
use crate::plugins::image::blocks::to_rgba8;

/// Z of a unit normal from its X and Y, in bytes as the map holds them.
pub fn rebuilt_z(x: u8, y: u8) -> u8 {
    let unit = |v: u8| f32::from(v) / 127.5 - 1.0;
    let (x, y) = (unit(x), unit(y));
    let z = (1.0 - x * x - y * y).max(0.0).sqrt();
    ((z + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8
}

/// RGBA8 texels of one level's blocks, or the decoder's refusal on short bytes.
pub fn decode_level(
    blocks: &[u8],
    width: u32,
    height: u32,
    format: BlockFormat,
    layout: Layout,
) -> Result<Vec<u8>, &'static str> {
    let decoder = match (format, layout) {
        (BlockFormat::Bc7, Layout::TwoChannel) => texture2ddecoder::decode_bc5,
        (BlockFormat::Bc7, Layout::Rgba) => texture2ddecoder::decode_bc7,
        (BlockFormat::Astc, _) => texture2ddecoder::decode_astc_4_4,
        (BlockFormat::Etc2, Layout::Rgba) => texture2ddecoder::decode_etc2_rgba8,
        (BlockFormat::Etc2, Layout::TwoChannel) => decode_eac_rg,
    };
    let mut rgba = to_rgba8(
        decoder,
        BLOCK_BYTES,
        blocks,
        width as usize,
        height as usize,
        "truncated",
    )?;
    if layout == Layout::TwoChannel {
        for texel in rgba.chunks_mut(4) {
            if format == BlockFormat::Astc {
                texel[1] = texel[3];
            }
            texel[2] = rebuilt_z(texel[0], texel[1]);
            texel[3] = 255;
        }
    }
    Ok(rgba)
}

/// An EAC RG11 surface, X in R and Y in G, each half through the decoder's ETC2
/// alpha block, which shares its fields — `texture2ddecoder`'s own RG11 reader
/// takes the index bits in the wrong byte order. An R11 channel whose
/// multiplier is not 0, the only kind `eac.rs` writes, is that block's byte
/// times eight plus four, clamped to 2047, which the card's unorm read returns
/// to the same byte: `(8b + 4) / 2047 × 255` lies within half a level of `b`.
fn decode_eac_rg(
    blocks: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    let across = width.div_ceil(4);
    if blocks.len() < across * height.div_ceil(4) * BLOCK_BYTES || image.len() < width * height {
        return Err("truncated");
    }
    for (index, block) in blocks.chunks_exact(BLOCK_BYTES).enumerate() {
        let (bx, by) = (index % across * 4, index / across * 4);
        if by >= height {
            break;
        }
        let [mut x, mut y] = [[0u32; 16]; 2];
        texture2ddecoder::decode_etc2_a8_block(&block[..8], &mut x);
        texture2ddecoder::decode_etc2_a8_block(&block[8..], &mut y);
        let channel = |word: &u32| word.to_le_bytes()[3];
        for (texel, (x, y)) in x.iter().zip(&y).enumerate() {
            let (px, py) = (bx + texel % 4, by + texel / 4);
            if px < width && py < height {
                image[py * width + px] = u32::from_le_bytes([0, channel(y), channel(x), 255]);
            }
        }
    }
    Ok(())
}
