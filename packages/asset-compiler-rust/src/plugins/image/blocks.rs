//! Reconstruction of a 4 × 4 block surface to RGBA8, shared by the drivers that receive blocks
//! already compressed for the GPU: `dds` and `ktx2` name their codecs each in their own way —
//! `dwFourCC`, `dxgiFormat`, `vkFormat` — but once the decoder is chosen, walking its pixels is
//! exactly the same work, and it is written only once.
//!
//! `texture2ddecoder` expands each block by the integer interpolation the codec specification
//! defines — no extra rounding or filter is added here — and returns one pixel per thirty-two-bit
//! word, bytes B, G, R, A in memory. The only thing this module then does is put those bytes back
//! into the contract order, R, G, B, A.
use super::DecodedImage;

/// Signature of a block decoder: the level's bytes, its dimensions, the returned pixels.
pub(super) type BlockDecode = fn(&[u8], usize, usize, &mut [u32]) -> Result<(), &'static str>;

/// Expands level 0 of a 4 × 4 block surface. The decoder works one block row at a time into a
/// four-line pixel buffer, copied immediately into the image: no second buffer the size of the
/// image. Each block decodes on its own, so cutting by row yields exactly the same pixels.
/// `truncated` is the reason the calling driver gives a level shorter than the announced block
/// count — a named refusal, never a panic.
pub(super) fn to_rgba8(
    decode: BlockDecode,
    block_bytes: usize,
    level: &[u8],
    width: usize,
    height: usize,
    truncated: &'static str,
) -> std::result::Result<Vec<u8>, &'static str> {
    let row_bytes = width.div_ceil(4) * block_bytes;
    let mut strip = vec![0u32; width * height.min(4)];
    let mut rgba = Vec::with_capacity(width * height * 4);
    for (row, top) in (0..height).step_by(4).enumerate() {
        let lines = (height - top).min(4);
        let blocks = level.get(row * row_bytes..).ok_or(truncated)?;
        decode(blocks, width, lines, &mut strip).map_err(|_| truncated)?;
        rgba.extend(strip[..width * lines].iter().flat_map(|pixel| {
            let [b, g, r, a] = pixel.to_le_bytes();
            [r, g, b, a]
        }));
    }
    Ok(rgba)
}

/// The RGBA8 image of these bytes, or the calling driver's named reason when they do not fill the
/// announced surface. The image contract forbids an empty image: `from_raw` is the only gate.
pub(super) fn image(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    truncated: &'static str,
) -> std::result::Result<DecodedImage, &'static str> {
    ::image::RgbaImage::from_raw(width, height, rgba)
        .map(DecodedImage::Rgba8)
        .ok_or(truncated)
}
