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

/// Bytes of a `width` × `height` surface of 4 × 4 blocks of `block_bytes` each. Blocks always cover
/// multiples of four pixels: a 1 × 1 level still weighs a whole block. The count saturates rather
/// than overflowing: absurd dimensions give an absurd need, hence a refusal.
pub(crate) fn surface_bytes(width: u32, height: u32, block_bytes: u64) -> u64 {
    u64::from(width.div_ceil(4))
        .saturating_mul(u64::from(height.div_ceil(4)))
        .saturating_mul(block_bytes)
}

/// Bytes of a `width` × `height` surface of uncompressed pixels, four bytes each; saturating, as
/// `surface_bytes`.
pub(crate) fn rgba8_bytes(width: u32, height: u32) -> u64 {
    u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(4)
}

/// Expands level 0 of a 4 × 4 block surface. The decoder works one block row at a time into a
/// four-line pixel buffer, copied immediately into the image: no second buffer the size of the
/// image. Each block decodes on its own, so cutting by row yields exactly the same pixels.
/// `truncated` is the reason the calling driver gives a level shorter than the announced block
/// count — a named refusal, never a panic.
pub(crate) fn to_rgba8(
    decode: BlockDecode,
    block_bytes: usize,
    level: &[u8],
    width: usize,
    height: usize,
    truncated: &'static str,
) -> std::result::Result<Vec<u8>, &'static str> {
    let row_bytes = surface_bytes(width as u32, 1, block_bytes as u64) as usize;
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
