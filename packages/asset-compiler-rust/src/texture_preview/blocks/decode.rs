//! Reconstruction of what the writers emit, by the independent decoder the
//! `dds` and `ktx2` drivers already trust (`texture2ddecoder`), which shares no
//! line with them: the quality gate reads the blocks back through it, so the
//! loss it publishes is the loss a graphics card will show, never the writer's
//! own idea of it. A two-channel level comes back with X in R and Y in G
//! whichever the family — BC5 lays them there, the luminance-alpha block puts
//! Y in A and it is moved — with Z rebuilt as the shader rebuilds it.
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
